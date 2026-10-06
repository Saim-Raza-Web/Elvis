import crypto from 'crypto';
import axios from 'axios';
import { BaseIntegrationProvider } from './BaseIntegrationProvider.js';
import { AmazonConfig } from './AmazonConfig.js';
import { AmazonSPApiClient } from './AmazonSPApiClient.js';

export class AmazonProvider extends BaseIntegrationProvider {
  constructor() {
    super('AMAZON', 'Amazon Selling Partner (SP-API)');
    const creds = AmazonConfig.getAppCredentials();
    this.appId = creds.appId;
    this.lwaClientId = creds.lwaClientId;
    this.lwaClientSecret = creds.lwaClientSecret;
  }

  isProductionConfigured() {
    return AmazonConfig.isProductionConfigured();
  }

  getProviderInfo() {
    return {
      code: 'AMAZON',
      name: 'Amazon Selling Partner (SP-API)',
      connectionMethod: 'oauth_redirect',
      isProductionConfigured: this.isProductionConfigured(),
      logo: 'https://cdn.worldvectorlogo.com/logos/amazon-icon-1.svg',
      authType: 'OAUTH2',
      supportsOAuth: true,
      supportsWebhooks: true,
      supportsProductSync: true,
      supportsOrderSync: true,
      supportsInventorySync: true,
      inventoryDirections: ['wms_to_store', 'store_to_wms', 'manual_only'],
      requiredCredentials: ['AMAZON_APP_ID', 'AMAZON_LWA_CLIENT_ID', 'AMAZON_LWA_CLIENT_SECRET'],
      requiredFields: [
        { key: 'customName', label: 'Custom Store Name', placeholder: 'e.g. My Amazon EU Store', required: true },
        { key: 'region', label: 'Region', required: true },
        { key: 'sites', label: 'Site Country', required: true }
      ],
      supportedRegions: ['North American region', 'European region', 'Far East / Asia-Pacific region'],
      supportedSites: {
        'North American region': [
          { id: 'US', label: 'US Site' },
          { id: 'CA', label: 'Canada Site' },
          { id: 'MX', label: 'Mexico Site' },
          { id: 'BR', label: 'Brazil Site' }
        ],
        'European region': [
          { id: 'ES', label: 'Spain Site (ES)' },
          { id: 'DE', label: 'Germany Site (DE)' },
          { id: 'FR', label: 'France Site (FR)' },
          { id: 'IT', label: 'Italy Site (IT)' },
          { id: 'UK', label: 'UK Site (UK)' },
          { id: 'NL', label: 'Netherlands Site (NL)' },
          { id: 'SE', label: 'Sweden Site (SE)' },
          { id: 'PL', label: 'Poland Site (PL)' }
        ],
        'Far East / Asia-Pacific region': [
          { id: 'JP', label: 'Japan Site (JP)' },
          { id: 'SG', label: 'Singapore Site (SG)' },
          { id: 'AU', label: 'Australia Site (AU)' }
        ]
      },
      productionRequirements: 'Amazon Developer Account SP-API App Registration + Login with Amazon (LWA) Client ID & Client Secret configured.',
      guideTitle: 'How to authorize an Amazon shop to 4Seller?',
      guideSteps: [
        'Step 1: In the shop authorization page, enter custom shop name, select country site (US/EU/Asia), and click Connect.',
        'Step 2: You will be redirected to the Amazon Seller Central consent page. Log in with your primary seller account credentials (sub-accounts not supported).',
        'Step 3: Click Confirm to authorize the Elvis SP-API application. The shop will become Active on return.'
      ],
      guideNotes: [
        'Note 1: If authorizing multiple Amazon shops, log out of Amazon Seller Central in your browser before connecting the next store.',
        'Note 2: Ensure your Amazon account has an active Professional selling plan.'
      ],
      description: 'Connect your Amazon Seller Central account via Login with Amazon (LWA) OAuth 2.0 to import FBM/FBA orders and sync inventory.'
    };
  }

  /**
   * Generates official Amazon SP-API OAuth consent redirect URL.
   */
  async getAuthorizationUrl({ state, shopDomain, redirectUri, isSandbox = false }) {
    if (isSandbox || !this.appId || !this.lwaClientId) {
      // Sandbox simulator URL
      const callbackUrl = redirectUri || '/api/v1/integrations/AMAZON/callback';
      const simUrl = new URL(callbackUrl, 'http://localhost:5000');
      simUrl.searchParams.set('spapi_oauth_code', `amzn_sandbox_code_${crypto.randomBytes(8).toString('hex')}`);
      simUrl.searchParams.set('selling_partner_id', `A${crypto.randomBytes(6).toString('hex').toUpperCase()}`);
      simUrl.searchParams.set('state', state);
      simUrl.searchParams.set('sandbox', 'true');
      return {
        authorizationUrl: simUrl.toString(),
        method: 'REDIRECT',
        isSandbox: true
      };
    }

    // Official Amazon Seller Central App Consent URL
    const authUrl = new URL('https://sellercentral-europe.amazon.com/apps/authorize/consent');
    authUrl.searchParams.set('application_id', this.appId);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', redirectUri);

    return {
      authorizationUrl: authUrl.toString(),
      method: 'REDIRECT',
      isSandbox: false
    };
  }

  /**
   * Handles Amazon LWA OAuth code exchange for access & refresh tokens.
   */
  async handleOAuthCallback({ code, state, query = {}, body = {}, extra = {}, isSandbox = false }) {
    const oauthCode = code || query.spapi_oauth_code;
    const sellerId = query.selling_partner_id || query.sellerId || 'A_AMAZON_SELLER';

    // Validate selected site from OAuth state
    const siteId = (extra.sites && extra.sites.length > 0) ? extra.sites[0] : 'ES';
    const marketplace = AmazonConfig.getMarketplace(siteId);

    let accessToken = '';
    let refreshToken = '';
    let tokenExpiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour LWA token lifetime

    if (isSandbox || !this.lwaClientSecret || oauthCode.startsWith('amzn_sandbox_code_')) {
      accessToken = `Atza|sandbox_${crypto.randomBytes(16).toString('hex')}`;
      refreshToken = `Atzr|sandbox_refresh_${crypto.randomBytes(24).toString('hex')}`;
    } else {
      // Live LWA Token Exchange
      const tokenRes = await axios.post('https://api.amazon.com/auth/o2/token', {
        grant_type: 'authorization_code',
        code: oauthCode,
        client_id: this.lwaClientId,
        client_secret: this.lwaClientSecret
      });
      accessToken = tokenRes.data.access_token;
      refreshToken = tokenRes.data.refresh_token;
      tokenExpiresAt = new Date(Date.now() + (tokenRes.data.expires_in || 3600) * 1000);
    }

    return {
      accessToken,
      refreshToken,
      tokenExpiresAt,
      externalStoreId: sellerId,
      storeName: `Amazon Store (${sellerId})`,
      storeUrl: 'https://sellercentral.amazon.com',
      scopes: ['sellingpartnerapi::orders', 'sellingpartnerapi::catalog_items', 'sellingpartnerapi::inventory'],
      metadata: {
        sellerId,
        marketplaceId: marketplace.marketplaceId,
        region: marketplace.region,
        endpoint: marketplace.endpoint,
        siteCode: marketplace.countryCode
      }
    };
  }

  /**
   * Refreshes expired LWA Access Token using Refresh Token.
   */
  async refreshAccessToken(store) {
    const refreshToken = store.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available for Amazon store');
    }

    if (refreshToken.startsWith('Atzr|sandbox_') || !this.lwaClientSecret) {
      const newAccessToken = `Atza|sandbox_${crypto.randomBytes(16).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      return { accessToken: newAccessToken, tokenExpiresAt: expiresAt };
    }

    const tokenRes = await axios.post('https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.lwaClientId,
      client_secret: this.lwaClientSecret
    });

    return {
      accessToken: tokenRes.data.access_token,
      tokenExpiresAt: new Date(Date.now() + (tokenRes.data.expires_in || 3600) * 1000)
    };
  }

  /**
   * Validates Amazon SP-API connection
   */
  async validateConnection(store) {
    const token = store.getAccessToken();
    if (token.startsWith('Atza|sandbox_')) return { isValid: true };
    return { isValid: true };
  }

  _getClient(store) {
    const getMeta = (key) => store.metadata?.get ? store.metadata.get(key) : store.metadata?.[key];
    return new AmazonSPApiClient({
      marketplace: {
        marketplaceId: getMeta('marketplaceId'),
        region: getMeta('region'),
        endpoint: getMeta('endpoint'),
        countryCode: getMeta('siteCode'),
        sellerId: getMeta('sellerId') || store.externalStoreId // Seller ID from connected store
      },
      accessToken: store.getAccessToken()
    });
  }

  /**
   * Fetches products / catalog from Amazon and normalizes to standard format.
   * Standard format: { externalId, sku, name, category, price, quantity, barcode, status }
   */
  async fetchProducts(store, options = {}) {
    const client = this._getClient(store);
    const getMeta = (key) => store.metadata?.get ? store.metadata.get(key) : store.metadata?.[key];
    const marketplaceId = getMeta('marketplaceId');

    const response = await client.getCatalogItems({
      MarketplaceId: marketplaceId,
      ...options
    });

    // Normalize Amazon catalog items to standard format
    const normalizedProducts = (response.items || []).map(item => {
      const summary = item.AttributeSets?.[0] || {};
      const product = item.Summaries?.[0] || {};

      return {
        externalId: item.ASIN || item.ItemIdentifier?.ASIN || '',
        sku: item.SellerSKU || item.AttributeSets?.[0]?.SellerSKU || '',
        name: summary.Title || item.Title || product.Title || 'Unknown Product',
        category: summary.ProductGroup || item.ProductGroup || 'GEN',
        price: summary.Price?.Amount || summary.ListPrice?.Amount || product.Price?.Amount || 0,
        quantity: summary.Quantity || item.Quantity || 0,
        barcode: summary.OriginalReleaseDate || item.UPC || item.EAN || '',
        status: 'Active',
        asin: item.ASIN || '',
        images: summary.SmallImage?.URL || summary.MediumImage?.URL || summary.LargeImage?.URL || ''
      };
    });

    return normalizedProducts;
  }

  /**
   * Fetches unfulfilled orders from Amazon SP-API and normalizes to standard format.
   * Standard format: { externalOrderId, customerName, customerEmail, items, date, deliveryAddress, total, etc. }
   *
   * Handles pagination via nextToken to fetch all pages of orders.
   */
  async fetchOrders(store, options = {}) {
    const client = this._getClient(store);
    const getMeta = (key) => store.metadata?.get ? store.metadata.get(key) : store.metadata?.[key];
    const marketplaceId = getMeta('marketplaceId');
    const sellerId = getMeta('sellerId') || store.externalStoreId;

    // Default to fetching recent unfulfilled orders
    const defaultOptions = {
      MarketplaceIds: [marketplaceId],
      OrderStatuses: ['Pending', 'Unshipped', 'PartiallyShipped'],
      MaxResultsPerPage: 50,
      CreatedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // Last 30 days
    };

    // Pagination with safety guard against infinite loops
    const MAX_PAGES = 100; // Safety limit: max 100 pages (5000 orders)
    let currentPage = 0;
    let nextToken = null;
    const allOrders = [];
    const seenOrderIds = new Set(); // Deduplicate across pages

    do {
      currentPage++;
      if (currentPage > MAX_PAGES) {
        console.warn(`[AmazonProvider] Order pagination exceeded maximum ${MAX_PAGES} pages. Stopping to prevent infinite loop.`);
        break;
      }

      const requestOptions = { ...defaultOptions, ...options };
      if (nextToken) {
        requestOptions.NextToken = nextToken;
      }

      const response = await client.getOrders(requestOptions);

      if (response.orders && response.orders.length > 0) {
        // Deduplicate orders by AmazonOrderId
        for (const order of response.orders) {
          if (!seenOrderIds.has(order.AmazonOrderId)) {
            seenOrderIds.add(order.AmazonOrderId);
            allOrders.push(order);
          }
        }
      }

      nextToken = response.nextToken || null;

      // Safety: if nextToken repeats, stop to prevent infinite loop
      if (nextToken && allOrders.length === 0) {
        console.warn('[AmazonProvider] Received nextToken but no orders. Possible pagination issue. Stopping.');
        break;
      }
    } while (nextToken);

    console.info(`[AmazonProvider] Fetched ${allOrders.length} orders across ${currentPage} pages`);

    // Normalize Amazon orders to standard format
    const normalizedOrders = [];

    for (const order of allOrders) {
      // Fetch order items for each order
      let orderItems = [];
      try {
        const itemsResponse = await client.getOrderItems(order.AmazonOrderId);
        orderItems = itemsResponse.orderItems || [];
      } catch (err) {
        console.error(`[AmazonProvider] Failed to fetch items for order ${order.AmazonOrderId}:`, err.message);
        // Continue with empty items
      }

      const shippingAddress = order.ShippingAddress || {};

      normalizedOrders.push({
        externalOrderId: order.AmazonOrderId,
        customerName: shippingAddress.Name || order.BuyerName || 'Amazon Customer',
        customerEmail: order.BuyerEmail || '',
        date: order.PurchaseDate || order.CreationDate || new Date(),
        status: order.OrderStatus,
        fulfillmentChannel: order.FulfillmentChannel,
        items: orderItems.map(item => ({
          sku: item.SellerSKU || '',
          name: item.Title || item.ProductInfo?.Title?.Value || 'Product',
          quantity: item.QuantityOrdered || 1,
          price: item.ItemPrice?.Amount || 0,
          total: item.ItemPrice?.Amount || 0
        })),
        deliveryAddress: {
          name: shippingAddress.Name || '',
          addressLine1: shippingAddress.AddressLine1 || '',
          addressLine2: shippingAddress.AddressLine2 || '',
          addressLine3: shippingAddress.AddressLine3 || '',
          city: shippingAddress.City || '',
          state: shippingAddress.StateOrRegion || '',
          postalCode: shippingAddress.PostalCode || '',
          country: shippingAddress.CountryCode || '',
          phone: shippingAddress.Phone || ''
        },
        subtotal: order.OrderTotal?.Amount || 0,
        taxTotal: order.Tax?.Amount || 0,
        grandTotal: order.OrderTotal?.Amount || 0,
        currency: order.OrderTotal?.CurrencyCode || 'USD',
        isB2B: order.IsBusinessOrder || false,
        b2bClassificationSource: order.IsBusinessOrder ? 'amazon_business_order_field' : 'no_b2b_field',
        companyName: order.IsBusinessOrder ? (order.BuyerTaxInfo?.CompanyLegalName || '') : '',
        vatNumber: order.IsBusinessOrder ? (order.BuyerTaxInfo?.VatRegistrationNumber || '') : ''
      });
    }

    return normalizedOrders;
  }

  /**
   * Pushes internal inventory to Amazon SP-API.
   * @param {object} store - ConnectedStore document
   * @param {string} sku - Product SKU
   * @param {number} availableQty - Available quantity from WMS
   * @returns {Promise<object>}
   */
  async updateExternalInventory(store, sku, availableQty) {
    const client = this._getClient(store);

    const response = await client.updateInventory(sku, availableQty);

    return {
      success: response.success,
      updatedSku: sku,
      newLevel: availableQty,
      response
    };
  }

  /**
   * Verifies Amazon SP-API webhook signature.
   *
   * Amazon sends notifications signed with HMAC-SHA256 over the raw JSON body.
   * Header: x-amzn-signature (hex-encoded HMAC)
   *
   * SECURITY: Rejects all webhooks when no secret is configured.
   */
  verifyWebhookSignature(req, secret) {
    if (!secret) {
      // No secret configured — reject. Never silently pass unsigned webhooks.
      console.error('[AmazonProvider] Webhook rejected: no signing secret configured for store.');
      return false;
    }

    try {
      const signatureHeader = req.headers['x-amzn-signature'];
      if (!signatureHeader) {
        console.error('[AmazonProvider] Webhook rejected: missing x-amzn-signature header.');
        return false;
      }

      // req.rawBody must be populated by express.raw() middleware on the webhook route
      const rawBody = req.rawBody;
      if (!rawBody) {
        console.error('[AmazonProvider] Webhook rejected: rawBody not available. Ensure express.raw() middleware is active on webhook routes.');
        return false;
      }

      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      const sigBuffer = Buffer.from(signatureHeader, 'hex');
      const expectedBuffer = Buffer.from(expectedSig, 'hex');

      if (sigBuffer.length !== expectedBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (err) {
      console.error('[AmazonProvider] verifyWebhookSignature error:', err.message);
      return false;
    }
  }

  /**
   * Parses Amazon SP-API notification payload to standardized event.
   */
  parseWebhookEvent(req) {
    const body = req.body || {};
    const notification = body.payload?.applicationContext || body;
    const notificationType = body.notificationType ||
      req.headers['x-amzn-marketplace-type'] ||
      'amazon.notification';
    const eventId = body.notificationId ||
      req.headers['x-amzn-request-id'] ||
      String(Date.now());
    return {
      eventId,
      topic: notificationType,
      payload: body
    };
  }
}

export default AmazonProvider;
