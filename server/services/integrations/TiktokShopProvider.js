import axios from 'axios';
import crypto from 'crypto';
import { BaseIntegrationProvider } from './BaseIntegrationProvider.js';

export class TiktokShopProvider extends BaseIntegrationProvider {
  constructor(options = {}) {
    super('TIKTOK_SHOP', 'TikTok Shop', options);
    this.appKey = process.env.TIKTOK_APP_KEY || '';
    this.appSecret = process.env.TIKTOK_APP_SECRET || '';
    this.authBaseUrl = process.env.TIKTOK_AUTH_URL || 'https://services.tiktokshop.com/open/authorize';
    this.apiBaseUrl = process.env.TIKTOK_API_URL || 'https://open-api.tiktokglobalshop.com';
  }

  isProductionConfigured() {
    return Boolean(this.appKey && this.appSecret);
  }

  getProviderInfo() {
    return {
      code: 'TIKTOK_SHOP',
      name: 'TikTok Shop Partner',
      connectionMethod: 'oauth_redirect',
      isProductionConfigured: this.isProductionConfigured(),
      logo: '🎵',
      authType: 'OAUTH2',
      supportsOAuth: true,
      supportsWebhooks: true,
      supportsProductSync: true,
      supportsOrderSync: true,
      supportsInventorySync: true,
      inventoryDirections: ['wms_to_store', 'store_to_wms', 'manual_only'],
      requiredCredentials: ['TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET'],
      requiredFields: [
        { key: 'customName', label: 'Custom Store Name', placeholder: 'e.g. My TikTok Shop US', required: true },
        { key: 'region', label: 'Region', required: true },
        { key: 'sites', label: 'Target Shop / Sites', required: true },
        { key: 'contactEmail', label: 'Contact Email', placeholder: 'seller@yourdomain.com', required: false }
      ],
      supportedRegions: ['North America', 'Europe (UK & EU Sites)', 'Southeast Asia'],
      supportedSites: {
        'North America': [
          { id: 'US', label: 'US Shop' }
        ],
        'Europe (UK & EU Sites)': [
          { id: 'UK', label: 'UK Shop' },
          { id: 'ES', label: 'Spain Shop (ES)' },
          { id: 'DE', label: 'Germany Shop (DE)' },
          { id: 'FR', label: 'France Shop (FR)' },
          { id: 'IT', label: 'Italy Shop (IT)' }
        ],
        'Southeast Asia': [
          { id: 'SG', label: 'Singapore Shop' },
          { id: 'MY', label: 'Malaysia Shop' },
          { id: 'PH', label: 'Philippines Shop' },
          { id: 'TH', label: 'Thailand Shop' },
          { id: 'VN', label: 'Vietnam Shop' }
        ]
      },
      productionRequirements: 'TikTok Shop Partner Developer Account + Approved Service App Key & App Secret.',
      guideTitle: 'How to Authorize TikTok Shop with 4Seller?',
      guideSteps: [
        'Step 1: Enter your customized store name, select your target region/country sites, and click Connect.',
        'Step 2: You will be redirected to the official TikTok Seller Center App & Service Store authorization page.',
        'Step 3: Check Target Shop, select authorization duration, enter contact email, check precaution boxes, and click Confirm to install.',
        'Step 4: On the final authorization page, wait 3 seconds for the Authorize button to activate and click Authorize. The store status will become Active!'
      ],
      guideNotes: [
        'Note 1: Only the primary TikTok account holds the authorization to connect; if using a sub-account, switch to the primary account before binding.',
        'Note 2: If connecting multiple TikTok stores, log out of TikTok Seller Center before authorizing the next store.'
      ],
      description: 'Official TikTok Shop Partner Open Platform OAuth 2.0 connection for viral social commerce sales and fulfillment.'
    };
  }

  async getAuthorizationUrl({ state, redirectUri, isSandbox = false }) {
    if (isSandbox || !this.appKey) {
      const callbackUrl = redirectUri || '/api/v1/integrations/TIKTOK_SHOP/callback';
      const simUrl = new URL(callbackUrl, 'http://localhost:5000');
      simUrl.searchParams.set('code', `tts_code_${crypto.randomBytes(8).toString('hex')}`);
      simUrl.searchParams.set('state', state);
      simUrl.searchParams.set('sandbox', 'true');
      return {
        authorizationUrl: simUrl.toString(),
        method: 'REDIRECT',
        isSandbox: true
      };
    }

    const encodedRedirect = encodeURIComponent(redirectUri);
    const url = `${this.authBaseUrl}?service_id=${this.appKey}&state=${state}&redirect_uri=${encodedRedirect}`;
    return { authorizationUrl: url, method: 'GET', isSandbox: false };
  }

  async handleOAuthCallback({ code, state, isSandbox = false }) {
    if (isSandbox || !this.appSecret) {
      return {
        accessToken: `tts_access_${code || 'sandbox'}_${crypto.randomBytes(8).toString('hex')}`,
        refreshToken: `tts_refresh_${crypto.randomBytes(16).toString('hex')}`,
        tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        externalStoreId: `TTS-SHOP-${Date.now().toString().slice(-4)}`,
        storeName: 'TikTok Viral Beauty & Gadgets ES',
        storeUrl: 'https://shop.tiktok.com',
        scopes: ['product.read', 'product.write', 'order.read', 'fulfillment.write'],
        metadata: {
          sellerId: 'TTS-SELLER-9901',
          openId: 'tt_open_id_123',
          sandbox: true
        }
      };
    }

    const res = await axios.get(`${this.apiBaseUrl}/api/v2/token/get`, {
      params: {
        app_key: this.appKey,
        app_secret: this.appSecret,
        auth_code: code,
        grant_type: 'authorized_code'
      }
    });

    const data = res.data?.data || res.data;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: new Date(Date.now() + (data.access_token_expire_in || 604800) * 1000),
      externalStoreId: String(data.open_id || data.seller_base_region || 'TIKTOK-STORE'),
      storeName: data.seller_name || 'TikTok Shop',
      storeUrl: 'https://shop.tiktok.com',
      scopes: ['products', 'orders', 'fulfillment'],
      metadata: {
        openId: data.open_id,
        sellerName: data.seller_name
      }
    };
  }

  async validateConnection(store) {
    const token = store.getAccessToken();
    if (!token) return { isValid: false, error: 'No access token stored.' };
    if (token.startsWith('tts_access_') || !this.appSecret) {
      return { isValid: true };
    }
    try {
      await axios.get(`${this.apiBaseUrl}/api/seller/global/get_authorized_shop`, {
        headers: { 'x-tts-access-token': token }
      });
      return { isValid: true };
    } catch (err) {
      return { isValid: false, error: err.response?.data?.message || err.message };
    }
  }

  async fetchProducts(store, options = {}) {
    const token = store.getAccessToken();
    if (token.startsWith('tts_access_') || !this.appSecret) {
      return [
        {
          externalId: 'tts-prod-501',
          sku: 'TTS-SUNSCREEN-SPF50',
          name: 'Viral Glow Watermelon Hydrating Sunscreen SPF50+ (50ml)',
          category: 'Beauty & Skincare',
          price: 19.99,
          quantity: 200,
          barcode: '84350050001',
          status: 'active'
        },
        {
          externalId: 'tts-prod-502',
          sku: 'TTS-PORTABLE-BLENDER',
          name: 'Portable USB Rechargeable Smoothie Blender (Mint Green)',
          category: 'Kitchen & Gadgets',
          price: 28.50,
          quantity: 110,
          barcode: '84350050002',
          status: 'active'
        }
      ];
    }

    const res = await axios.post(`${this.apiBaseUrl}/api/products/search`, {
      page_size: options.limit || 50,
      page_number: options.page || 1
    }, {
      headers: { 'x-tts-access-token': token }
    });

    const products = res.data?.data?.products || [];
    return products.map(p => ({
      externalId: String(p.id),
      sku: p.skus?.[0]?.seller_sku || `TTS-${p.id}`,
      name: p.title,
      category: p.category_list?.[0]?.name || 'General',
      price: parseFloat(p.skus?.[0]?.price?.tax_exclusive_price) || 0,
      quantity: parseInt(p.skus?.[0]?.stock_infos?.[0]?.available_stock, 10) || 0,
      barcode: '',
      status: p.status === 'ACTIVATE' ? 'active' : 'inactive'
    }));
  }

  async fetchOrders(store, options = {}) {
    const token = store.getAccessToken();
    if (token.startsWith('tts_access_') || !this.appSecret) {
      return [
        {
          externalOrderId: options.externalOrderId || 'TTS-ORD-332910',
          orderNumber: options.orderNumber || '#TTS-332910',
          customerName: 'Lucia Morales',
          customerEmail: 'lucia.morales@example.es',
          date: new Date('2026-08-26T20:45:00Z'),
          status: 'pending',
          // B2B: TikTok Shop sandbox — buyer_tax_info not available in test mode
          isB2B: false,
          b2bClassificationSource: 'tiktok_sandbox_default',
          companyName: '',
          vatNumber: '',
          items: [
            { sku: 'TTS-SUNSCREEN-SPF50', name: 'Viral Glow Watermelon Hydrating Sunscreen SPF50+ (50ml)', quantity: 2, price: 19.99, total: 39.98 }
          ],
          subtotal: 39.98,
          taxTotal: 8.40,
          grandTotal: 48.38,
          deliveryAddress: {
            street: 'Calle Gran Via',
            number: '68',
            city: 'Bilbao',
            postcode: '48011',
            region: 'Basque Country',
            country: 'Spain'
          }
        }
      ];
    }

    const res = await axios.post(`${this.apiBaseUrl}/api/orders/search`, {
      page_size: options.limit || 50,
      order_status: 'AWAITING_SHIPMENT'
    }, {
      headers: { 'x-tts-access-token': token }
    });

    const orders = res.data?.data?.order_list || [];
    return orders.map(o => {
      // TikTok Shop Order API includes buyer_tax_info for EU B2B orders
      const taxInfo    = o.buyer_tax_info || {};
      const companyName = taxInfo.company_name || '';
      const vatNumber   = taxInfo.tax_id || taxInfo.vat_id || '';
      let isB2B = false;
      let b2bClassificationSource = 'tiktok_api_no_b2b_field';
      if (vatNumber) {
        isB2B = true;
        b2bClassificationSource = 'tiktok_buyer_tax_info_vat';
      } else if (companyName) {
        isB2B = true;
        b2bClassificationSource = 'tiktok_buyer_tax_info_company';
      }

      return {
        externalOrderId: String(o.order_id),
        orderNumber: `#TTS-${o.order_id}`,
        customerName: o.recipient_address?.name || 'TikTok Shop Buyer',
        customerEmail: o.buyer_email || 'buyer@tiktok.com',
        date: new Date(o.create_time * 1000 || Date.now()),
        status: 'pending',
        isB2B,
        b2bClassificationSource,
        companyName,
        vatNumber,
        items: (o.item_list || []).map(i => ({
          sku: i.seller_sku || `TTS-SKU-${i.sku_id}`,
          name: i.product_name,
          quantity: parseInt(i.quantity, 10) || 1,
          price: parseFloat(i.sku_price) || 0,
          total: parseFloat(i.item_tax_exclusive_amount || i.sku_price) || 0
        })),
        subtotal: parseFloat(o.item_tax_exclusive_amount || o.payment_info?.total_amount) || 0,
        taxTotal: parseFloat(o.tax_amount || 0) || 0,
        grandTotal: parseFloat(o.payment_info?.total_amount) || 0,
        deliveryAddress: {
          street: o.recipient_address?.address_line1 || '',
          number: '',
          city: o.recipient_address?.city || '',
          postcode: o.recipient_address?.postal_code || '',
          region: o.recipient_address?.region || '',
          country: o.recipient_address?.region_code || 'Spain'
        }
      };
    });
  }

  async updateExternalInventory(store, sku, availableQty) {
    const token = store.getAccessToken();
    if (token.startsWith('tts_access_') || !this.appSecret) {
      return { success: true, updatedSku: sku, newLevel: availableQty, mode: 'sandbox' };
    }
    await axios.post(`${this.apiBaseUrl}/api/products/stocks`, {
      skus: [{ id: sku, available_stock: availableQty }]
    }, {
      headers: { 'x-tts-access-token': token }
    });
    return { success: true, updatedSku: sku, newLevel: availableQty, mode: 'live' };
  }

  /**
   * Verifies TikTok Shop webhook signature.
   *
   * TikTok Shop computes HMAC-SHA256 over the string:
   *   timestamp + nonce + rawBody
   * and delivers it hex-encoded in the `x-tts-signature` header.
   * Additional headers: `x-tts-timestamp`, `x-tts-nonce`
   *
   * SECURITY: Rejects all webhooks when no signing secret is configured.
   */
  verifyWebhookSignature(req, secret) {
    if (!secret) {
      console.error('[TiktokShopProvider] Webhook rejected: no signing secret configured for store.');
      return false;
    }
    try {
      const signatureHeader = req.headers['x-tts-signature'];
      if (!signatureHeader) {
        console.error('[TiktokShopProvider] Webhook rejected: missing x-tts-signature header.');
        return false;
      }
      const rawBody = req.rawBody;
      if (!rawBody) {
        console.error('[TiktokShopProvider] Webhook rejected: rawBody not available.');
        return false;
      }
      const timestamp = req.headers['x-tts-timestamp'] || '';
      const nonce = req.headers['x-tts-nonce'] || '';
      // TikTok canonical message: timestamp + nonce + rawBody (as UTF-8)
      const message = `${timestamp}${nonce}${rawBody.toString('utf8')}`;
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(message)
        .digest('hex');
      const sigBuffer = Buffer.from(signatureHeader.toLowerCase(), 'hex');
      const expectedBuffer = Buffer.from(expectedSig, 'hex');
      if (sigBuffer.length !== expectedBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (err) {
      console.error('[TiktokShopProvider] verifyWebhookSignature error:', err.message);
      return false;
    }
  }

  /**
   * Parses TikTok Shop webhook payload to standardized event.
   */
  parseWebhookEvent(req) {
    const body = req.body || {};
    return {
      eventId: body.message?.message_id || req.headers['x-tts-nonce'] || String(Date.now()),
      topic: body.type || body.event_type || 'tiktok.notification',
      payload: body
    };
  }
}
