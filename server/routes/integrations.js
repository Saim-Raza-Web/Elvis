import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import ConnectedStore from '../models/ConnectedStore.js';
import IntegrationSyncLog from '../models/IntegrationSyncLog.js';
import IntegrationEvent from '../models/IntegrationEvent.js';
import { generateOAuthState, validateOAuthState } from '../utils/oauthSecurity.js';
import { providerRegistry } from '../services/integrations/ProviderRegistry.js';
import { SyncManager } from '../services/integrations/SyncManager.js';

const router = express.Router();

const requireAdminOrManager = requireRole('admin', 'manager');
const requireAdminOnly = requireRole('admin');

// ═════════════════════════════════════════════════════════════════════════════
// 1. PROVIDERS & METADATA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/integrations/providers
 * Returns all supported platforms (Shopify, WooCommerce, Amazon, eBay) and capabilities.
 */
router.get('/providers', protect, (req, res) => {
  try {
    const providers = providerRegistry.listAll();
    res.json(providers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CONNECTION INITIATION (OAUTH & TOKEN)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/integrations/:provider/connect
 * Generates official OAuth authorization redirect URL with signed CSRF state.
 */
router.post('/:provider/connect', protect, requireAdminOrManager, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const { provider } = req.params;
    const providerInstance = providerRegistry.get(provider);

    if (providerInstance.connectionMethod === 'token') {
      return res.status(400).json({ 
        success: false, 
        message: `${providerInstance.name} uses token-based authorization. Please connect with an authorization token.` 
      });
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const defaultCallback = `${protocol}://${host}/api/v1/integrations/${provider.toUpperCase()}/callback`;
    const redirectUri = req.body.redirectUri || defaultCallback;

    // Generate cryptographically signed state token
    const state = generateOAuthState({
      companyId: req.user.company,
      userId: req.user._id,
      provider: provider.toUpperCase(),
      redirectUri,
      extra: {
        customName: req.body.customName,
        region: req.body.region,
        sites: req.body.sites,
        shopDomain: req.body.shopDomain || req.body.storeUrl,
        isSandbox: Boolean(req.body.isSandbox)
      }
    });

    const result = await providerInstance.getAuthorizationUrl({
      state,
      shopDomain: req.body.shopDomain || req.body.storeUrl,
      redirectUri,
      region: req.body.region,
      sites: req.body.sites,
      isSandbox: Boolean(req.body.isSandbox)
    });

    res.json({
      success: true,
      provider: provider.toUpperCase(),
      authorizationUrl: result.authorizationUrl,
      method: result.method || 'REDIRECT',
      isSandbox: Boolean(result.isSandbox),
      state
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/integrations/:provider/connect-token
 * Direct token-based store connection (e.g. Temu MMS Authorization Token).
 */
router.post('/:provider/connect-token', protect, requireAdminOrManager, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const { provider } = req.params;
    const providerInstance = providerRegistry.get(provider);

    const { token, customName, shopType, siteCountry, isSandbox = false } = req.body;

    if (!token || !token.trim()) {
      return res.status(400).json({ message: 'Authorization Token is required' });
    }
    if (!customName || !customName.trim()) {
      return res.status(400).json({ message: 'Custom store name is required' });
    }

    const tokenResult = await providerInstance.connectWithToken({
      token,
      customName: customName.trim(),
      shopType,
      siteCountry,
      isSandbox: Boolean(isSandbox)
    });

    const finalStatus = tokenResult.isSandbox ? 'sandbox_connected' : 'connected';

    // Find existing or create new store record
    let store = await ConnectedStore.findOne({
      company: req.user.company,
      provider: provider.toUpperCase(),
      externalStoreId: tokenResult.externalStoreId
    });

    if (store) {
      store.storeName = customName.trim();
      store.customStoreName = customName.trim();
      store.setAuthorizationToken(tokenResult.accessToken);
      store.setAccessToken(tokenResult.accessToken);
      store.tokenExpiresAt = tokenResult.tokenExpiresAt;
      store.shopType = shopType || store.shopType;
      store.country = siteCountry || store.country;
      store.connectionMethod = 'token';
      store.isSandbox = Boolean(tokenResult.isSandbox);
      store.status = finalStatus;
      store.lastError = '';
      if (tokenResult.metadata) {
        store.metadata = new Map(Object.entries(tokenResult.metadata));
      }
      await store.save();
    } else {
      store = new ConnectedStore({
        company: req.user.company,
        provider: provider.toUpperCase(),
        storeName: customName.trim(),
        customStoreName: customName.trim(),
        storeUrl: tokenResult.storeUrl || 'https://www.temu.com',
        externalStoreId: tokenResult.externalStoreId,
        shopType: shopType || '',
        country: siteCountry || '',
        marketplace: `Temu (${siteCountry || 'Global'})`,
        connectionMethod: 'token',
        isSandbox: Boolean(tokenResult.isSandbox),
        status: finalStatus,
        authType: 'TOKEN',
        scopes: tokenResult.scopes || [],
        tokenExpiresAt: tokenResult.tokenExpiresAt,
        metadata: tokenResult.metadata || {},
        createdBy: req.user._id
      });
      store.setAuthorizationToken(tokenResult.accessToken);
      store.setAccessToken(tokenResult.accessToken);
      await store.save();
    }

    // Trigger initial background sync
    SyncManager.runSync(store._id, req.user.company, { syncType: 'full', trigger: 'manual' }).catch(err => {
      console.error(`Initial sync error for store ${store._id}:`, err.message);
    });

    res.status(200).json({
      success: true,
      message: `Store ${store.storeName} connected successfully!`,
      store
    });
  } catch (err) {
    next(err);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. OAUTH CALLBACK & TOKEN EXCHANGE (GET & POST)
// ═════════════════════════════════════════════════════════════════════════════

async function handleCallbackLogic(req, res, next) {
  try {
    const rawState = req.query.state || req.body.state || req.query.user_id;
    const stateValidation = validateOAuthState(rawState);

    if (!stateValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'OAuth State Validation Failed',
        message: stateValidation.error
      });
    }

    const { companyId, userId, provider, extra } = stateValidation.payload;
    const providerInstance = providerRegistry.get(provider);

    const isSandboxMode = Boolean(extra?.isSandbox || req.query.sandbox === 'true');

    // Exchange auth code for tokens
    const tokenResult = await providerInstance.handleOAuthCallback({
      code: req.query.code || req.query.spapi_oauth_code || req.body.code,
      state: rawState,
      shopDomain: req.query.shop || req.query.store_url || extra?.shopDomain,
      query: req.query,
      body: req.body,
      isSandbox: isSandboxMode
    });

    const customName = extra?.customName;
    const region = extra?.region;
    const sites = extra?.sites;
    const isSandboxFinal = Boolean(tokenResult.isSandbox || isSandboxMode);
    const storeStatus = isSandboxFinal ? 'sandbox_connected' : 'connected';

    // Check for existing store connection for this company + provider + URL
    let store = await ConnectedStore.findOne({
      company: companyId,
      provider: provider.toUpperCase(),
      storeUrl: tokenResult.storeUrl
    });

    if (store) {
      // Update existing store connection
      if (customName) {
        store.storeName = customName;
        store.customStoreName = customName;
      }
      store.setAccessToken(tokenResult.accessToken);
      if (tokenResult.refreshToken) store.setRefreshToken(tokenResult.refreshToken);
      store.tokenExpiresAt = tokenResult.tokenExpiresAt;
      store.isSandbox = isSandboxFinal;
      store.status = storeStatus;
      store.connectionMethod = 'oauth_redirect';
      store.lastError = '';
      if (region) store.region = region;
      if (tokenResult.metadata || region || sites) {
        store.metadata = new Map(Object.entries({
          ...(tokenResult.metadata || {}),
          ...(region ? { region } : {}),
          ...(sites ? { sites } : {})
        }));
      }
      await store.save();
    } else {
      // Create new ConnectedStore
      store = new ConnectedStore({
        company: companyId,
        provider: provider.toUpperCase(),
        storeName: customName || tokenResult.storeName || `${provider} Store`,
        customStoreName: customName || tokenResult.storeName || `${provider} Store`,
        storeUrl: tokenResult.storeUrl,
        externalStoreId: tokenResult.externalStoreId || '',
        marketplace: region || provider,
        region: region || '',
        connectionMethod: 'oauth_redirect',
        isSandbox: isSandboxFinal,
        status: storeStatus,
        authType: 'OAUTH2',
        scopes: tokenResult.scopes || [],
        tokenExpiresAt: tokenResult.tokenExpiresAt,
        metadata: {
          ...(tokenResult.metadata || {}),
          ...(region ? { region } : {}),
          ...(sites ? { sites } : {})
        },
        createdBy: userId
      });
      store.setAccessToken(tokenResult.accessToken);
      if (tokenResult.refreshToken) store.setRefreshToken(tokenResult.refreshToken);
      await store.save();
    }

    // Trigger initial background sync asynchronously (non-blocking)
    SyncManager.runSync(store._id, companyId, { syncType: 'full', trigger: 'manual' }).catch(err => {
      console.error(`Initial auto-sync error for store ${store._id}:`, err.message);
    });

    // If request accepts HTML (browser navigation), redirect to frontend
    if (req.accepts('html') && !req.xhr) {
      const clientBase = process.env.CLIENT_URL || 'http://localhost:5173';
      const clientUrl = `${clientBase}/?page=ecommerce&connected=true&store=${encodeURIComponent(store.storeName)}&sandbox=${isSandboxFinal}`;
      return res.redirect(clientUrl);
    }

    res.status(200).json({
      success: true,
      message: `Store ${store.storeName} connected successfully!`,
      store
    });
  } catch (err) {
    if (req.accepts('html') && !req.xhr) {
      const clientBase = process.env.CLIENT_URL || 'http://localhost:5173';
      return res.redirect(`${clientBase}/?page=ecommerce&error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
}

router.get('/:provider/callback', handleCallbackLogic);
router.post('/:provider/callback', handleCallbackLogic);

// ═════════════════════════════════════════════════════════════════════════════
// 4. CONNECTED STORES MANAGEMENT (CRUD & SYNC)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/integrations/stores
 * Returns all connected stores for the authenticated user's company.
 */
router.get('/stores', protect, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const { status, provider, search } = req.query;
    const filter = { company: req.user.company };

    if (status && status !== 'all') filter.status = status;
    if (provider && provider !== 'all') filter.provider = provider.toUpperCase();
    if (search) {
      filter.$or = [
        { storeName: new RegExp(search, 'i') },
        { storeUrl: new RegExp(search, 'i') }
      ];
    }

    const result = await paginateQuery(ConnectedStore, filter, req, { sort: { createdAt: -1 } });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/integrations/stores/:id
 * Gets detailed store info and health metrics.
 */
router.get('/stores/:id', protect, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const store = await ConnectedStore.findOne({ _id: req.params.id, company: req.user.company });
    if (!store) return res.status(404).json({ message: 'Connected store not found' });

    res.json(store);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/integrations/stores/:id/settings
 * Updates sync configuration rules and inventory direction.
 */
router.put('/stores/:id/settings', protect, requireAdminOnly, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const store = await ConnectedStore.findOne({ _id: req.params.id, company: req.user.company });
    if (!store) return res.status(404).json({ message: 'Connected store not found' });

    if (req.body.storeName) store.storeName = req.body.storeName.trim();
    if (req.body.syncSettings) {
      store.syncSettings = {
        ...store.syncSettings.toObject(),
        ...req.body.syncSettings
      };
    }

    await store.save();
    res.json({ success: true, store });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/integrations/stores/:id/sync
 * Manually triggers a synchronization job.
 */
router.post('/stores/:id/sync', protect, requireAdminOrManager, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const { syncType = 'full' } = req.body;
    const result = await SyncManager.runSync(req.params.id, req.user.company, {
      syncType,
      trigger: 'manual'
    });

    res.json(result);
  } catch (err) {
    if (err.message.includes('currently syncing') || err.message.includes('locked')) {
      return res.status(409).json({ message: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/v1/integrations/stores/:id/sync-history
 * Returns paginated audit logs for a store.
 */
router.get('/stores/:id/sync-history', protect, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const filter = {
      company: req.user.company
    };
    if (req.params.id !== 'all') {
      filter.connectedStore = req.params.id;
    }

    const result = await paginateQuery(IntegrationSyncLog, filter, req, { sort: { createdAt: -1 } });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/integrations/stores/:id/disconnect
 * Disconnects the store and revokes credentials.
 */
router.post('/stores/:id/disconnect', protect, requireAdminOnly, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const store = await ConnectedStore.findOne({ _id: req.params.id, company: req.user.company });
    if (!store) return res.status(404).json({ message: 'Connected store not found' });

    const provider = providerRegistry.get(store.provider);
    if (provider) {
      await provider.disconnect(store).catch(() => {});
    }

    store.status = 'disconnected';
    store.encryptedAccessToken = '';
    store.encryptedRefreshToken = '';
    await store.save();

    res.json({ success: true, message: `Store ${store.storeName} disconnected.` });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/integrations/stores/:id
 * Deletes a store record permanently.
 */
router.delete('/stores/:id', protect, requireAdminOnly, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company tenant context required' });
    }

    const store = await ConnectedStore.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!store) return res.status(404).json({ message: 'Connected store not found' });

    // Clean up sync logs
    await IntegrationSyncLog.deleteMany({ connectedStore: req.params.id });

    res.json({ success: true, message: 'Store removed successfully.' });
  } catch (err) {
    next(err);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. WEBHOOKS INGESTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/integrations/webhooks/:provider/:storeId
 * Webhook endpoint for order/product updates from external platforms.
 */
router.post('/webhooks/:provider/:storeId', async (req, res) => {
  try {
    const { provider, storeId } = req.params;
    const store = await ConnectedStore.findById(storeId);
    if (!store || store.status !== 'connected') {
      return res.status(404).json({ message: 'Store not found or inactive' });
    }

    const providerInstance = providerRegistry.get(provider);
    if (store.webhookSecret && !providerInstance.verifyWebhookSignature(req, store.webhookSecret)) {
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }

    const event = providerInstance.parseWebhookEvent(req);

    // Idempotent deduplication check
    try {
      await IntegrationEvent.create({
        company: store.company,
        connectedStore: store._id,
        provider: provider.toUpperCase(),
        eventId: event.eventId,
        topic: event.topic,
        payload: event.payload,
        status: 'received'
      });
    } catch (err) {
      if (err.code === 11000) {
        // Already processed duplicate event
        return res.status(200).json({ status: 'ignored', reason: 'Duplicate event ID' });
      }
    }

    // Trigger sync for orders/products asynchronously
    SyncManager.runSync(store._id, store.company, { syncType: 'full', trigger: 'webhook' }).catch(err => {
      console.error(`Webhook-triggered sync failed for store ${store._id}:`, err.message);
    });

    res.status(200).json({ status: 'received' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

export default router;
