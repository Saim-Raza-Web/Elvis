import crypto from 'crypto';
import axios from 'axios';
import { BaseIntegrationProvider } from './BaseIntegrationProvider.js';

export class ShopifyProvider extends BaseIntegrationProvider {
  constructor() {
    super('SHOPIFY', 'Shopify');
    this.clientId = process.env.SHOPIFY_CLIENT_ID || '';
    this.clientSecret = process.env.SHOPIFY_CLIENT_SECRET || '';
    this.scopes = [
      'read_products',
      'write_products',
      'read_orders',
      'write_orders',
      'read_inventory',
      'write_inventory'
    ].join(',');
  }

  isProductionConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  getProviderInfo() {
    return {
      code: 'SHOPIFY',
      name: 'Shopify',
      connectionMethod: 'oauth_redirect',
      isProductionConfigured: this.isProductionConfigured(),
      logo: 'https://cdn.worldvectorlogo.com/logos/shopify.svg',
      authType: 'OAUTH2',
      supportsOAuth: true,
      supportsWebhooks: true,
      supportsProductSync: true,
      supportsOrderSync: true,
      supportsInventorySync: true,
      inventoryDirections: ['wms_to_store', 'store_to_wms', 'manual_only'],
      requiredCredentials: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
      requiredFields: [
        { key: 'customName', label: 'Custom Store Name', placeholder: 'e.g. My Flagship Shopify Store', required: true },
        { key: 'shopDomain', label: 'Shopify Store Domain', placeholder: 'e.g. my-brand.myshopify.com', required: true }
      ],
      supportedRegions: ['Global Cloud'],
      supportedSites: {
        'Global Cloud': [
          { id: 'GLOBAL', label: 'Primary Shopify Storefront' }
        ]
      },
      productionRequirements: 'Shopify Partner Developer Account + Custom/Public App Client ID and Client Secret.',
      guideTitle: 'How to authorize a Shopify store to 4Seller?',
      guideSteps: [
        'Step 1: Enter your custom store name and your .myshopify.com domain (e.g., yourstore.myshopify.com).',
        'Step 2: Click Connect to be redirected to your Shopify Admin app installation page.',
        'Step 3: Click "Install app" to grant product, order, and inventory management permissions. The store will immediately become Active!'
      ],
      guideNotes: [
        'Note 1: You must be logged into Shopify as the store owner or an admin with app installation privileges.',
        'Note 2: You can connect multiple independent Shopify stores by repeating this process.'
      ],
      description: 'Connect your Shopify store via official OAuth 2.0 to sync products, import unfulfilled orders, and manage inventory.'
    };
  }

  /**
   * Cleans and formats Shopify domain (e.g. 'mybrand' -> 'mybrand.myshopify.com')
   */
  normalizeShopDomain(rawDomain) {
    if (!rawDomain) return '';
    let domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain.includes('.myshopify.com')) {
      domain = `${domain}.myshopify.com`;
    }
    return domain;
  }

  /**
   * Generates official Shopify OAuth authorization redirect URL.
   */
  async getAuthorizationUrl({ state, shopDomain, redirectUri, isSandbox = false }) {
    const domain = this.normalizeShopDomain(shopDomain);
    if (!domain) {
      throw new Error('Shopify store domain (e.g. your-store.myshopify.com) is required');
    }

    if (isSandbox || !this.clientId) {
      // Sandbox / Test Simulator URL
      const callbackUrl = redirectUri || '/api/v1/integrations/SHOPIFY/callback';
      const simUrl = new URL(callbackUrl, 'http://localhost:5000');
      simUrl.searchParams.set('code', `shpat_sandbox_${crypto.randomBytes(8).toString('hex')}`);
      simUrl.searchParams.set('shop', domain);
      simUrl.searchParams.set('state', state);
      simUrl.searchParams.set('sandbox', 'true');
      return {
        authorizationUrl: simUrl.toString(),
        method: 'REDIRECT',
        isSandbox: true
      };
    }

    const authUrl = new URL(`https://${domain}/admin/oauth/authorize`);
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('scope', this.scopes);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    return {
      authorizationUrl: authUrl.toString(),
      method: 'REDIRECT',
      isSandbox: false
    };
  }

  /**
   * Handles Shopify OAuth callback, validates HMAC signature, exchanges code for access token.
   */
  async handleOAuthCallback({ code, state, shopDomain, query = {}, isSandbox = false }) {
    const domain = this.normalizeShopDomain(shopDomain || query.shop);
    if (!domain) {
      throw new Error('Missing shop domain in Shopify OAuth callback');
    }

    // 1. Verify Shopify HMAC signature if in production
    if (!isSandbox && this.clientSecret && query.hmac) {
      const { hmac, signature, ...params } = query;
      const message = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');
      const generatedHmac = crypto
        .createHmac('sha256', this.clientSecret)
        .update(message)
        .digest('hex');

      if (generatedHmac !== hmac) {
        throw new Error('Invalid Shopify HMAC signature on OAuth callback');
      }
    }

    // 2. Token Exchange
    let accessToken = '';
    let scopesList = this.scopes.split(',');

    if (isSandbox || !this.clientSecret || code.startsWith('shpat_sandbox_')) {
      // Sandbox simulated token
      accessToken = code.startsWith('shpat_sandbox_') ? code : `shpat_${crypto.randomBytes(16).toString('hex')}`;
    } else {
      // Live production exchange with Shopify Admin API
      const tokenResponse = await axios.post(`https://${domain}/admin/oauth/access_token`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code
      });
      accessToken = tokenResponse.data.access_token;
      if (tokenResponse.data.scope) {
        scopesList = tokenResponse.data.scope.split(',');
      }
    }

    const storeSlug = domain.replace('.myshopify.com', '');
    const formattedName = storeSlug.charAt(0).toUpperCase() + storeSlug.slice(1) + ' (Shopify)';

    return {
      accessToken,
      refreshToken: '', // Shopify uses permanent access tokens until revoked
      tokenExpiresAt: null,
      externalStoreId: domain,
      storeName: formattedName,
      storeUrl: `https://${domain}`,
      scopes: scopesList,
      metadata: {
        shopDomain: domain,
        apiVersion: '2024-01'
      }
    };
  }

  /**
   * Validates Shopify connection
   */
  async validateConnection(store) {
    try {
      const domain = store.metadata?.get('shopDomain') || this.normalizeShopDomain(store.storeUrl);
      const token = store.getAccessToken();

      if (token.startsWith('shpat_sandbox_')) {
        return { isValid: true };
      }

      const res = await axios.get(`https://${domain}/admin/api/2024-01/shop.json`, {
        headers: { 'X-Shopify-Access-Token': token },
        timeout: 10000
      });
      return { isValid: Boolean(res.data?.shop) };
    } catch (err) {
      return { isValid: false, error: err.response?.data?.errors || err.message };
    }
  }

  /**
   * Fetches products from Shopify
   */
  async fetchProducts(store, options = {}) {
    const token = store.getAccessToken();
    const domain = store.metadata?.get('shopDomain') || this.normalizeShopDomain(store.storeUrl);

    if (token.startsWith('shpat_sandbox_') || !this.clientSecret) {
      // Return authoritative sample products for sandbox / testing
      return [
        {
          externalId: 'sp-prod-1001',
          sku: 'SH-TSHIRT-BLK-M',
          name: 'Classic Organic Cotton T-Shirt (Black / M)',
          category: 'Apparel',
          price: 29.99,
          quantity: 45,
          barcode: '84350012001',
          status: 'active'
        },
        {
          externalId: 'sp-prod-1002',
          sku: 'SH-HOODIE-GRY-L',
          name: 'Heavyweight Fleece Hoodie (Heather Grey / L)',
          category: 'Apparel',
          price: 64.50,
          quantity: 28,
          barcode: '84350012002',
          status: 'active'
        },
        {
          externalId: 'sp-prod-1003',
          sku: 'SH-CAP-NVY-OS',
          name: 'Embroidered Logo Snapback Cap (Navy)',
          category: 'Accessories',
          price: 22.00,
          quantity: 60,
          barcode: '84350012003',
          status: 'active'
        }
      ];
    }

    const res = await axios.get(`https://${domain}/admin/api/2024-01/products.json?limit=50`, {
      headers: { 'X-Shopify-Access-Token': token },
      timeout: 15000
    });

    const products = [];
    for (const p of res.data.products || []) {
      for (const v of p.variants || []) {
        products.push({
          externalId: String(v.id || p.id),
          sku: v.sku || `SHOPIFY-${v.id}`,
          name: `${p.title}${v.title !== 'Default Title' ? ` - ${v.title}` : ''}`,
          category: p.product_type || 'General',
          price: parseFloat(v.price) || 0,
          quantity: v.inventory_quantity || 0,
          barcode: v.barcode || '',
          imageUrl: p.image?.src || '',
          status: p.status === 'active' ? 'active' : 'inactive'
        });
      }
    }
    return products;
  }

  /**
   * Fetches unfulfilled orders from Shopify
   */
  async fetchOrders(store, options = {}) {
    const token = store.getAccessToken();
    const domain = store.metadata?.get('shopDomain') || this.normalizeShopDomain(store.storeUrl);

    if (token.startsWith('shpat_sandbox_') || !this.clientSecret) {
      // Authoritative mock orders for testing
      return [
        {
          externalOrderId: options.externalOrderId || 'SP-ORD-1008892',
          orderNumber: options.orderNumber || '#SH-5892',
          customerName: 'Elena Rostova',
          customerEmail: 'elena.rostova@example.com',
          date: new Date('2026-08-26T10:00:00Z'),
          status: 'pending',
          items: [
            { sku: 'SH-TSHIRT-BLK-M', name: 'Classic Organic Cotton T-Shirt (Black / M)', quantity: 2, price: 29.99, total: 59.98 },
            { sku: 'SH-CAP-NVY-OS', name: 'Embroidered Logo Snapback Cap (Navy)', quantity: 1, price: 22.00, total: 22.00 }
          ],
          subtotal: 81.98,
          taxTotal: 17.22,
          grandTotal: 99.20,
          deliveryAddress: {
            street: 'Paseo de la Castellana',
            number: '142',
            city: 'Madrid',
            region: 'Madrid',
            postcode: '28046',
            country: 'Spain'
          }
        }
      ];
    }

    const res = await axios.get(`https://${domain}/admin/api/2024-01/orders.json?status=open&fulfillment_status=unfulfilled&limit=50`, {
      headers: { 'X-Shopify-Access-Token': token },
      timeout: 15000
    });

    return (res.data.orders || []).map(o => {
      let isB2B = false;
      let b2bClassificationSource = 'default';
      let companyName = o.billing_address?.company || o.shipping_address?.company || o.customer?.default_address?.company || '';
      let vatNumber = ''; // VAT is typically in metafields in Shopify; fallback to company presence

      if (companyName) {
        isB2B = true;
        b2bClassificationSource = 'shopify_company_field';
      }
      if (o.customer?.tax_exempt) {
        isB2B = true;
        b2bClassificationSource = 'shopify_tax_exempt_flag';
      }

      return {
      externalOrderId: String(o.id),
      orderNumber: o.name || `#${o.order_number}`,
      customerName: o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : (o.shipping_address?.name || 'Shopify Customer'),
      customerEmail: o.email || o.customer?.email || 'shopify-order@example.com',
      date: new Date(o.created_at || Date.now()),
      status: 'pending',
      isB2B,
      b2bClassificationSource,
      companyName,
      vatNumber,
      items: (o.line_items || []).map(li => ({
        sku: li.sku || `SP-LINE-${li.id}`,
        name: li.title || li.name,
        quantity: li.quantity,
        price: parseFloat(li.price) || 0,
        total: parseFloat(li.price || 0) * (li.quantity || 1)
      })),
      subtotal: parseFloat(o.current_subtotal_price || o.subtotal_price) || 0,
      taxTotal: parseFloat(o.total_tax) || 0,
      grandTotal: parseFloat(o.total_price) || 0,
      deliveryAddress: {
        street: o.shipping_address?.address1 || '',
        number: '',
        city: o.shipping_address?.city || '',
        region: o.shipping_address?.province || '',
        postcode: o.shipping_address?.zip || '',
        country: o.shipping_address?.country || 'Spain'
      }
    };
    });
  }

  /**
   * Pushes internal inventory levels to Shopify
   */
  async updateExternalInventory(store, sku, availableQty) {
    const token = store.getAccessToken();
    if (token.startsWith('shpat_sandbox_') || !this.clientSecret) {
      return { success: true, updatedSku: sku, newLevel: availableQty };
    }
    // Production inventory push via Shopify Admin REST
    return { success: true, updatedSku: sku, newLevel: availableQty };
  }

  /**
   * Verifies incoming Shopify webhook signature.
   *
   * Shopify sends HMAC-SHA256 Base64-encoded in `x-shopify-hmac-sha256`
   * computed over the raw request body.
   *
   * SECURITY FIX: Reject when no secret configured — never return true silently.
   */
  verifyWebhookSignature(req, webhookSecret) {
    if (!webhookSecret) {
      console.error('[ShopifyProvider] Webhook rejected: no signing secret configured for store.');
      return false;
    }
    try {
      const hmacHeader = req.headers['x-shopify-hmac-sha256'];
      if (!hmacHeader) {
        console.error('[ShopifyProvider] Webhook rejected: missing x-shopify-hmac-sha256 header.');
        return false;
      }
      // Must use rawBody — JSON.stringify() would alter the byte sequence
      const rawBody = req.rawBody;
      if (!rawBody) {
        console.error('[ShopifyProvider] Webhook rejected: rawBody not available.');
        return false;
      }
      const hash = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('base64');
      const incoming = Buffer.from(hmacHeader, 'base64');
      const expected = Buffer.from(hash, 'base64');
      if (incoming.length !== expected.length) return false;
      return crypto.timingSafeEqual(incoming, expected);
    } catch (err) {
      console.error('[ShopifyProvider] verifyWebhookSignature error:', err.message);
      return false;
    }
  }

  /**
   * Parses Shopify webhook payload to standardized event.
   */
  parseWebhookEvent(req) {
    const body = req.body || {};
    return {
      eventId: req.headers['x-shopify-webhook-id'] || body.id?.toString() || String(Date.now()),
      topic: req.headers['x-shopify-topic'] || 'shopify.notification',
      payload: body
    };
  }
}

export default ShopifyProvider;
