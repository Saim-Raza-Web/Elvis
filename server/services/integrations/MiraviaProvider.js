import axios from 'axios';
import crypto from 'crypto';
import { BaseIntegrationProvider } from './BaseIntegrationProvider.js';

export class MiraviaProvider extends BaseIntegrationProvider {
  constructor(options = {}) {
    super('MIRAVIA', 'Miravia EU', options);
    this.appKey = process.env.MIRAVIA_APP_KEY || '';
    this.appSecret = process.env.MIRAVIA_APP_SECRET || '';
    this.authBaseUrl = process.env.MIRAVIA_AUTH_URL || 'https://auth.miravia.es/oauth/authorize';
    this.apiBaseUrl = process.env.MIRAVIA_API_URL || 'https://api.miravia.es/rest';
  }

  isProductionConfigured() {
    return Boolean(this.appKey && this.appSecret);
  }

  getProviderInfo() {
    return {
      code: 'MIRAVIA',
      name: 'Miravia EU',
      connectionMethod: 'oauth_redirect',
      isProductionConfigured: this.isProductionConfigured(),
      logo: '🟣',
      authType: 'OAUTH2',
      supportsOAuth: true,
      supportsWebhooks: true,
      supportsProductSync: true,
      supportsOrderSync: true,
      supportsInventorySync: true,
      inventoryDirections: ['wms_to_store', 'store_to_wms', 'manual_only'],
      requiredCredentials: ['MIRAVIA_APP_KEY', 'MIRAVIA_APP_SECRET'],
      requiredFields: [
        { key: 'customName', label: 'Custom Store Name', placeholder: 'e.g. My Miravia Spain Store', required: true },
        { key: 'region', label: 'Marketplace Region', required: true },
        { key: 'sites', label: 'Site Country', required: true }
      ],
      supportedRegions: ['Iberia & Western Europe'],
      supportedSites: {
        'Iberia & Western Europe': [
          { id: 'ES', label: 'Miravia Spain (Miravia.es)' },
          { id: 'PT', label: 'Miravia Portugal (Miravia.pt)' },
          { id: 'FR', label: 'Miravia France (Miravia.fr)' },
          { id: 'IT', label: 'Miravia Italy (Miravia.it)' }
        ]
      },
      productionRequirements: 'Miravia Open Platform Developer App Key & App Secret.',
      guideTitle: 'How to authorize a Miravia shop to 4Seller?',
      guideSteps: [
        'Step 1: Enter your custom shop name and select your target Miravia site country (e.g. Spain).',
        'Step 2: Click Connect to be redirected to the Miravia Open Platform authorization gateway.',
        'Step 3: Sign in with your main Miravia merchant account and approve store permissions.',
        'Step 4: Once confirmed, you will be redirected back to the WMS and the store will be Activated!'
      ],
      guideNotes: [
        'Note 1: Log in with the primary merchant account associated with your Miravia shop.',
        'Note 2: If connecting multiple Miravia stores, log out of Miravia in your browser before connecting subsequent stores.'
      ],
      description: 'Miravia Marketplace EU official Open Platform OAuth 2.0 connection for Spanish & EU sellers.'
    };
  }

  async getAuthorizationUrl({ state, redirectUri, isSandbox = false }) {
    if (isSandbox || !this.appKey) {
      const callbackUrl = redirectUri || '/api/v1/integrations/MIRAVIA/callback';
      const simUrl = new URL(callbackUrl, 'http://localhost:5000');
      simUrl.searchParams.set('code', `mrv_code_${crypto.randomBytes(8).toString('hex')}`);
      simUrl.searchParams.set('state', state);
      simUrl.searchParams.set('sandbox', 'true');
      return {
        authorizationUrl: simUrl.toString(),
        method: 'REDIRECT',
        isSandbox: true
      };
    }

    const encodedRedirect = encodeURIComponent(redirectUri);
    const url = `${this.authBaseUrl}?response_type=code&client_id=${this.appKey}&state=${state}&redirect_uri=${encodedRedirect}`;
    return { authorizationUrl: url, method: 'GET', isSandbox: false };
  }

  async handleOAuthCallback({ code, state, isSandbox = false }) {
    if (isSandbox || !this.appSecret) {
      return {
        accessToken: `mrv_access_${code || 'sandbox'}_${crypto.randomBytes(8).toString('hex')}`,
        refreshToken: `mrv_refresh_${crypto.randomBytes(16).toString('hex')}`,
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        externalStoreId: `MIRAVIA-SELLER-${Date.now().toString().slice(-4)}`,
        storeName: 'Miravia Official Boutique ES',
        storeUrl: 'https://www.miravia.es',
        scopes: ['products:read', 'products:write', 'orders:read', 'fulfillment:write'],
        metadata: {
          country: 'ES',
          currency: 'EUR',
          sandbox: true
        }
      };
    }

    const res = await axios.post(`${this.apiBaseUrl}/auth/token/create`, {
      app_key: this.appKey,
      app_secret: this.appSecret,
      code
    });

    const data = res.data?.data || res.data;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: new Date(Date.now() + (data.expires_in || 2592000) * 1000),
      externalStoreId: String(data.seller_id || data.user_id || 'MIRAVIA-STORE'),
      storeName: data.seller_name || 'Miravia Boutique',
      storeUrl: 'https://www.miravia.es',
      scopes: data.scopes || ['products', 'orders'],
      metadata: {
        sellerId: data.seller_id,
        country: data.country || 'ES'
      }
    };
  }

  async validateConnection(store) {
    const token = store.getAccessToken();
    if (!token) return { isValid: false, error: 'No access token stored.' };
    if (token.startsWith('mrv_access_') || !this.appSecret) {
      return { isValid: true };
    }
    try {
      await axios.get(`${this.apiBaseUrl}/seller/get`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { isValid: true };
    } catch (err) {
      return { isValid: false, error: err.response?.data?.message || err.message };
    }
  }

  async fetchProducts(store, options = {}) {
    const token = store.getAccessToken();
    if (token.startsWith('mrv_access_') || !this.appSecret) {
      return [
        {
          externalId: 'mrv-prod-301',
          sku: 'MRV-LEATHER-BAG-BRN',
          name: 'Handcrafted Spanish Leather Messenger Bag (Cognac Brown)',
          category: 'Fashion & Bags',
          price: 119.00,
          quantity: 40,
          barcode: '84350030001',
          status: 'active'
        },
        {
          externalId: 'mrv-prod-302',
          sku: 'MRV-SILK-SCARF-BLU',
          name: '100% Pure Mulberry Silk Floral Printed Scarf',
          category: 'Accessories',
          price: 34.90,
          quantity: 75,
          barcode: '84350030002',
          status: 'active'
        }
      ];
    }

    const res = await axios.get(`${this.apiBaseUrl}/products/get`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { offset: 0, limit: options.limit || 50 }
    });

    const products = res.data?.data?.products || [];
    return products.map(p => ({
      externalId: String(p.item_id),
      sku: p.skus?.[0]?.SellerSku || `MRV-${p.item_id}`,
      name: p.attributes?.name || 'Miravia Product',
      category: p.primary_category_name || 'General',
      price: parseFloat(p.skus?.[0]?.price) || 0,
      quantity: parseInt(p.skus?.[0]?.quantity, 10) || 0,
      barcode: p.skus?.[0]?.barcode || '',
      status: p.status === 'active' ? 'active' : 'inactive'
    }));
  }

  async fetchOrders(store, options = {}) {
    const token = store.getAccessToken();
    if (token.startsWith('mrv_access_') || !this.appSecret) {
      return [
        {
          externalOrderId: options.externalOrderId || 'MRV-ORD-771822',
          orderNumber: options.orderNumber || '#MRV-771822',
          customerName: 'Carmen Navarro',
          customerEmail: 'carmen.navarro@example.es',
          date: new Date('2026-08-26T16:15:00Z'),
          status: 'pending',
          // B2B: Miravia sandbox does not expose VAT/business buyer fields
          isB2B: false,
          b2bClassificationSource: 'miravia_sandbox_default',
          companyName: '',
          vatNumber: '',
          items: [
            { sku: 'MRV-LEATHER-BAG-BRN', name: 'Handcrafted Spanish Leather Messenger Bag (Cognac Brown)', quantity: 1, price: 119.00, total: 119.00 }
          ],
          subtotal: 119.00,
          taxTotal: 24.99,
          grandTotal: 143.99,
          deliveryAddress: {
            street: 'Passeig de Gracia',
            number: '45',
            city: 'Barcelona',
            postcode: '08007',
            region: 'Catalonia',
            country: 'Spain'
          }
        }
      ];
    }

    const res = await axios.get(`${this.apiBaseUrl}/orders/get`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { status: 'unfulfilled', limit: options.limit || 50 }
    });

    const orders = res.data?.data?.orders || [];
    return orders.map(o => {
      // Miravia (Lazada Open Platform) includes customer_tax_id and buyer_company_name
      // for VAT-compliant EU B2B orders
      const vatNumber   = o.customer_tax_id || o.vat_number || '';
      const companyName = o.buyer_company_name || '';
      let isB2B = false;
      let b2bClassificationSource = 'miravia_api_no_b2b_field';
      if (vatNumber) {
        isB2B = true;
        b2bClassificationSource = 'miravia_customer_tax_id';
      } else if (companyName) {
        isB2B = true;
        b2bClassificationSource = 'miravia_buyer_company_name';
      }

      return {
        externalOrderId: String(o.order_id),
        orderNumber: `#MRV-${o.order_number || o.order_id}`,
        customerName: `${o.customer_first_name || ''} ${o.customer_last_name || ''}`.trim() || 'Miravia Buyer',
        customerEmail: o.buyer_email || 'buyer@miravia.es',
        date: new Date(o.created_at || Date.now()),
        status: 'pending',
        isB2B,
        b2bClassificationSource,
        companyName,
        vatNumber,
        items: (o.order_items || []).map(i => ({
          sku: i.sku || `MRV-SKU-${i.order_item_id}`,
          name: i.name,
          quantity: parseInt(i.quantity, 10) || 1,
          price: parseFloat(i.item_price) || 0,
          total: parseFloat(i.paid_price) || 0
        })),
        subtotal: parseFloat(o.price) || 0,
        taxTotal: parseFloat(o.tax_amount) || 0,
        grandTotal: parseFloat(o.voucher_platform ? o.price - o.voucher_platform : o.price) || 0,
        deliveryAddress: {
          street: o.address_shipping?.address1 || '',
          number: '',
          city: o.address_shipping?.city || '',
          postcode: o.address_shipping?.post_code || '',
          region: o.address_shipping?.country || '',
          country: 'Spain'
        }
      };
    });
  }

  async updateExternalInventory(store, sku, availableQty) {
    const token = store.getAccessToken();
    if (token.startsWith('mrv_access_') || !this.appSecret) {
      return { success: true, updatedSku: sku, newLevel: availableQty, mode: 'sandbox' };
    }
    await axios.post(`${this.apiBaseUrl}/product/price_quantity/update`, {
      sku,
      quantity: availableQty
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { success: true, updatedSku: sku, newLevel: availableQty, mode: 'live' };
  }

  /**
   * Verifies Miravia webhook signature.
   *
   * Miravia uses HMAC-SHA256 over the raw request body.
   * Header: x-miravia-signature (hex-encoded)
   *
   * SECURITY: Rejects all webhooks when no signing secret is configured.
   */
  verifyWebhookSignature(req, secret) {
    if (!secret) {
      console.error('[MiraviaProvider] Webhook rejected: no signing secret configured for store.');
      return false;
    }
    try {
      const signatureHeader = req.headers['x-miravia-signature'];
      if (!signatureHeader) {
        console.error('[MiraviaProvider] Webhook rejected: missing x-miravia-signature header.');
        return false;
      }
      const rawBody = req.rawBody;
      if (!rawBody) {
        console.error('[MiraviaProvider] Webhook rejected: rawBody not available.');
        return false;
      }
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      const sigBuffer = Buffer.from(signatureHeader.toLowerCase(), 'hex');
      const expectedBuffer = Buffer.from(expectedSig, 'hex');
      if (sigBuffer.length !== expectedBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (err) {
      console.error('[MiraviaProvider] verifyWebhookSignature error:', err.message);
      return false;
    }
  }

  /**
   * Parses Miravia webhook payload to standardized event.
   */
  parseWebhookEvent(req) {
    const body = req.body || {};
    return {
      eventId: body.message_id || body.id || String(Date.now()),
      topic: body.event_type || body.topic || 'miravia.notification',
      payload: body
    };
  }
}
