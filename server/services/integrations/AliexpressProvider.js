import axios from 'axios';
import crypto from 'crypto';
import { BaseIntegrationProvider } from './BaseIntegrationProvider.js';

export class AliexpressProvider extends BaseIntegrationProvider {
  constructor(options = {}) {
    super('ALIEXPRESS', 'AliExpress Open Platform', options);
    this.appKey = process.env.ALIEXPRESS_APP_KEY || '';
    this.appSecret = process.env.ALIEXPRESS_APP_SECRET || '';
    this.authBaseUrl = process.env.ALIEXPRESS_AUTH_URL || 'https://oauth.aliexpress.com/authorize';
    this.apiBaseUrl = process.env.ALIEXPRESS_API_URL || 'https://api-sg.aliexpress.com/rest';
  }

  isProductionConfigured() {
    return Boolean(this.appKey && this.appSecret);
  }

  getProviderInfo() {
    return {
      code: 'ALIEXPRESS',
      name: 'AliExpress Open Platform',
      connectionMethod: 'oauth_redirect',
      isProductionConfigured: this.isProductionConfigured(),
      logo: '🔴',
      authType: 'OAUTH2',
      supportsOAuth: true,
      supportsWebhooks: true,
      supportsProductSync: true,
      supportsOrderSync: true,
      supportsInventorySync: true,
      inventoryDirections: ['wms_to_store', 'store_to_wms', 'manual_only'],
      requiredCredentials: ['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET'],
      requiredFields: [
        { key: 'customName', label: 'Custom Store Name', placeholder: 'e.g. My AliExpress Plaza Store', required: true },
        { key: 'region', label: 'Marketplace Operation Mode', required: true },
        { key: 'sites', label: 'Site / Country', required: true }
      ],
      supportedRegions: ['European Plaza (Local to Local)', 'Global Cross-Border'],
      supportedSites: {
        'European Plaza (Local to Local)': [
          { id: 'ES', label: 'AliExpress Plaza Spain (ES)' },
          { id: 'FR', label: 'AliExpress France (FR)' },
          { id: 'IT', label: 'AliExpress Italy (IT)' },
          { id: 'DE', label: 'AliExpress Germany (DE)' }
        ],
        'Global Cross-Border': [
          { id: 'GLOBAL', label: 'AliExpress Global Cross-Border Store' }
        ]
      },
      productionRequirements: 'AliExpress Open Platform (TOP/AOP) Developer App Key & App Secret.',
      guideTitle: 'How to authorize an AliExpress shop to 4Seller?',
      guideSteps: [
        'Step 1: Enter your custom shop name and select your operation mode (European Plaza vs Cross-Border).',
        'Step 2: Click Connect to be redirected to the official AliExpress Open Platform authorization portal.',
        'Step 3: Log in with your AliExpress Seller account and grant authorization permissions.',
        'Step 4: Once confirmed, you will be redirected back to the WMS and your shop will be Active!'
      ],
      guideNotes: [
        'Note 1: Log in with the primary account of the AliExpress store (sub-accounts cannot authorize apps).',
        'Note 2: If connecting multiple AliExpress stores, log out of the previous account before authorizing a new one.'
      ],
      description: 'Official AliExpress Open Platform (TOP/AOP) OAuth 2.0 connection for global cross-border store synchronization.'
    };
  }

  async getAuthorizationUrl({ state, redirectUri, isSandbox = false }) {
    if (isSandbox || !this.appKey) {
      const callbackUrl = redirectUri || '/api/v1/integrations/ALIEXPRESS/callback';
      const simUrl = new URL(callbackUrl, 'http://localhost:5000');
      simUrl.searchParams.set('code', `ali_code_${crypto.randomBytes(8).toString('hex')}`);
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
        accessToken: `ali_access_${code || 'sandbox'}_${crypto.randomBytes(8).toString('hex')}`,
        refreshToken: `ali_refresh_${crypto.randomBytes(16).toString('hex')}`,
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        externalStoreId: `ALIEXPRESS-SELLER-${Date.now().toString().slice(-4)}`,
        storeName: 'AliExpress Global SuperStore',
        storeUrl: 'https://www.aliexpress.com',
        scopes: ['aliexpress.solution.order.get', 'aliexpress.solution.product.post'],
        metadata: {
          sellerId: 'ALI-SELLER-9988',
          sandbox: true
        }
      };
    }

    const res = await axios.post(`${this.apiBaseUrl}/auth/token/create`, {
      client_id: this.appKey,
      client_secret: this.appSecret,
      code,
      grant_type: 'authorization_code'
    });

    const data = res.data?.data || res.data;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: new Date(Date.now() + (data.expires_in || 2592000) * 1000),
      externalStoreId: String(data.user_id || data.seller_id || 'ALIEXPRESS-STORE'),
      storeName: data.user_nick || 'AliExpress Store',
      storeUrl: 'https://www.aliexpress.com',
      scopes: ['order', 'product', 'inventory'],
      metadata: {
        userId: data.user_id,
        userNick: data.user_nick
      }
    };
  }

  async validateConnection(store) {
    const token = store.getAccessToken();
    if (!token) return { isValid: false, error: 'No access token stored.' };
    if (token.startsWith('ali_access_') || !this.appSecret) {
      return { isValid: true };
    }
    try {
      await axios.get(`${this.apiBaseUrl}/user/get`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { isValid: true };
    } catch (err) {
      return { isValid: false, error: err.response?.data?.message || err.message };
    }
  }

  async fetchProducts(store, options = {}) {
    const token = store.getAccessToken();
    if (token.startsWith('ali_access_') || !this.appSecret) {
      return [
        {
          externalId: 'ali-prod-401',
          sku: 'ALI-WIRELESS-EARBUDS',
          name: 'TWS Bluetooth 5.3 Wireless Earbuds with ANC & ENC Display',
          category: 'Consumer Electronics',
          price: 24.99,
          quantity: 150,
          barcode: '84350040001',
          status: 'active'
        },
        {
          externalId: 'ali-prod-402',
          sku: 'ALI-MAGNETIC-POWERBANK',
          name: '10000mAh Magnetic Wireless Fast Charging Power Bank',
          category: 'Phone Accessories',
          price: 32.00,
          quantity: 90,
          barcode: '84350040002',
          status: 'active'
        }
      ];
    }

    const res = await axios.get(`${this.apiBaseUrl}/product/list`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { current_page: options.page || 1, page_size: options.limit || 50 }
    });

    const products = res.data?.data?.products || [];
    return products.map(p => ({
      externalId: String(p.product_id),
      sku: p.sku_code || `ALI-${p.product_id}`,
      name: p.subject || 'AliExpress Product',
      category: p.category_id || 'General',
      price: parseFloat(p.product_price) || 0,
      quantity: parseInt(p.total_stocks, 10) || 0,
      barcode: '',
      status: p.product_status_type === 'onSelling' ? 'active' : 'inactive'
    }));
  }

  async fetchOrders(store, options = {}) {
    const token = store.getAccessToken();
    if (token.startsWith('ali_access_') || !this.appSecret) {
      return [
        {
          externalOrderId: options.externalOrderId || 'ALI-ORD-991024',
          orderNumber: options.orderNumber || '#AE-991024',
          customerName: 'Santiago Perez',
          customerEmail: 'santiago.perez@example.es',
          date: new Date('2026-08-26T18:00:00Z'),
          status: 'pending',
          items: [
            { sku: 'ALI-WIRELESS-EARBUDS', name: 'TWS Bluetooth 5.3 Wireless Earbuds with ANC & ENC Display', quantity: 2, price: 24.99, total: 49.98 }
          ],
          subtotal: 49.98,
          taxTotal: 10.50,
          grandTotal: 60.48,
          deliveryAddress: {
            street: 'Avenida de America',
            number: '22',
            city: 'Valencia',
            postcode: '46001',
            region: 'Valencia',
            country: 'Spain'
          }
        }
      ];
    }

    const res = await axios.get(`${this.apiBaseUrl}/order/list`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { order_status: 'WAIT_SELLER_SEND_GOODS', page: options.page || 1, page_size: options.limit || 50 }
    });

    const orders = res.data?.data?.target_list || [];
    return orders.map(o => ({
      externalOrderId: String(o.order_id),
      orderNumber: `#AE-${o.order_id}`,
      customerName: o.receipt_address?.contact_person || 'AliExpress Customer',
      customerEmail: o.buyer_login_id || 'buyer@aliexpress.com',
      date: new Date(o.gmt_create || Date.now()),
      status: 'pending',
      items: (o.product_list || []).map(p => ({
        sku: p.sku_code || `ALI-SKU-${p.product_id}`,
        name: p.product_name,
        quantity: parseInt(p.product_count, 10) || 1,
        price: parseFloat(p.product_unit_price?.amount) || 0,
        total: parseFloat(p.total_product_amount?.amount) || 0
      })),
      subtotal: parseFloat(o.order_amount?.amount) || 0,
      taxTotal: parseFloat(o.tax_amount?.amount) || 0,
      grandTotal: parseFloat(o.order_amount?.amount) || 0,
      deliveryAddress: {
        street: o.receipt_address?.detail_address || '',
        number: '',
        city: o.receipt_address?.city || '',
        postcode: o.receipt_address?.zip || '',
        region: o.receipt_address?.province || '',
        country: o.receipt_address?.country || 'Spain'
      }
    }));
  }

  async updateExternalInventory(store, sku, availableQty) {
    const token = store.getAccessToken();
    if (token.startsWith('ali_access_') || !this.appSecret) {
      return { success: true, updatedSku: sku, newLevel: availableQty, mode: 'sandbox' };
    }
    await axios.post(`${this.apiBaseUrl}/product/stocks/update`, {
      sku_code: sku,
      stocks: availableQty
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { success: true, updatedSku: sku, newLevel: availableQty, mode: 'live' };
  }
}
