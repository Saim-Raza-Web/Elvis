/**
 * BaseIntegrationProvider - Common abstract interface for all ecommerce & marketplace adapters.
 * All concrete providers (Amazon, TikTok Shop, Shopify, Temu, WooCommerce, eBay, Miravia, AliExpress) extend this base class.
 */
export class BaseIntegrationProvider {
  constructor(providerCode, name, options = {}) {
    this.providerCode = providerCode; // e.g. 'AMAZON', 'TIKTOK_SHOP', 'TEMU', etc.
    this.name = name;
    this.options = options;
    this.connectionMethod = options.connectionMethod || 'oauth_redirect'; // 'oauth_redirect' | 'token' | 'api_credentials'
  }

  /**
   * Checks whether required production credentials / app configurations exist in environment.
   * @returns {boolean}
   */
  isProductionConfigured() {
    return false;
  }

  /**
   * Returns complete provider metadata, capabilities, connection requirements, and configuration status.
   */
  getProviderInfo() {
    return {
      code: this.providerCode,
      name: this.name,
      connectionMethod: this.connectionMethod,
      isProductionConfigured: this.isProductionConfigured(),
      authType: 'OAUTH2',
      supportsOAuth: this.connectionMethod === 'oauth_redirect',
      supportsWebhooks: true,
      supportsProductSync: true,
      supportsOrderSync: true,
      supportsInventorySync: true,
      inventoryDirections: ['wms_to_store', 'store_to_wms', 'manual_only'],
      requiredCredentials: [],
      requiredFields: [],
      supportedRegions: [],
      supportedSites: {},
      productionRequirements: '',
      guideTitle: '',
      guideSteps: [],
      guideNotes: []
    };
  }

  /**
   * Validates user-entered pre-authorization or token input.
   * @param {object} input
   */
  validateConnectionInput(input = {}) {
    if (!input.customName || !input.customName.trim()) {
      throw new Error(`Custom store name is required for ${this.name}`);
    }
  }

  /**
   * Generates the official OAuth authorization redirect URL.
   * Only applicable when connectionMethod === 'oauth_redirect'.
   * @param {object} params { state, shopDomain, redirectUri, isSandbox, region, sites }
   * @returns {Promise<{ authorizationUrl: string, method: string, isSandbox: boolean }>}
   */
  async getAuthorizationUrl(params) {
    throw new Error(`getAuthorizationUrl not supported for provider ${this.providerCode} (uses ${this.connectionMethod})`);
  }

  /**
   * Handles OAuth callback, exchanges authorization code for tokens.
   * Only applicable when connectionMethod === 'oauth_redirect'.
   * @param {object} params { code, state, shopDomain, query, isSandbox }
   * @returns {Promise<{ accessToken: string, refreshToken: string, tokenExpiresAt: Date, externalStoreId: string, storeName: string, metadata: object }>}
   */
  async handleOAuthCallback(params) {
    throw new Error(`handleOAuthCallback not supported for provider ${this.providerCode}`);
  }

  /**
   * Direct token-based connection authorization.
   * Applicable when connectionMethod === 'token'.
   * @param {object} params { token, customName, shopType, siteCountry, isSandbox }
   * @returns {Promise<{ accessToken: string, externalStoreId: string, storeName: string, metadata: object }>}
   */
  async connectWithToken(params) {
    throw new Error(`connectWithToken not supported for provider ${this.providerCode}`);
  }

  /**
   * Validates active connection with the provider.
   * @param {object} store - Mongoose ConnectedStore doc
   * @returns {Promise<{ isValid: boolean, error?: string }>}
   */
  async validateConnection(store) {
    return { isValid: true };
  }

  /**
   * Refreshes expired OAuth token where applicable.
   * @param {object} store - Mongoose ConnectedStore doc
   * @returns {Promise<{ accessToken: string, tokenExpiresAt: Date }>}
   */
  async refreshAccessToken(store) {
    return {
      accessToken: store.getAccessToken(),
      tokenExpiresAt: store.tokenExpiresAt
    };
  }

  /**
   * Fetches products from external platform in standardized format.
   * Standard item format: { externalId, sku, name, category, price, quantity, barcode, status }
   * @param {object} store - Mongoose ConnectedStore doc
   * @returns {Promise<Array<object>>}
   */
  async fetchProducts(store, options = {}) {
    throw new Error(`fetchProducts not implemented for provider ${this.providerCode}`);
  }

  /**
   * Fetches orders from external platform in standardized format.
   * @param {object} store - Mongoose ConnectedStore doc
   * @returns {Promise<Array<object>>}
   */
  async fetchOrders(store, options = {}) {
    throw new Error(`fetchOrders not implemented for provider ${this.providerCode}`);
  }

  /**
   * Pushes internal inventory levels to external store for a SKU.
   * @param {object} store - Mongoose ConnectedStore doc
   * @param {string} sku - Product SKU
   * @param {number} availableQty - Available quantity in WMS
   * @returns {Promise<{ success: boolean, updatedSku: string, newLevel: number }>}
   */
  async updateExternalInventory(store, sku, availableQty) {
    throw new Error(`updateExternalInventory not implemented for provider ${this.providerCode}`);
  }

  /**
   * Revokes tokens / disconnects remote store session.
   * @param {object} store - Mongoose ConnectedStore doc
   * @returns {Promise<boolean>}
   */
  async disconnect(store) {
    return true;
  }

  /**
   * Verifies incoming webhook signature.
   * @param {object} req - Express request
   * @param {string} secret - Webhook signing secret
   * @returns {boolean}
   */
  verifyWebhookSignature(req, secret) {
    return true;
  }

  /**
   * Parses inbound webhook payload to standardized event.
   * @param {object} req - Express request
   * @returns {{ eventId: string, topic: string, payload: object }}
   */
  parseWebhookEvent(req) {
    return {
      eventId: req.headers['x-event-id'] || String(Date.now()),
      topic: req.headers['x-topic'] || 'general',
      payload: req.body
    };
  }
}

export default BaseIntegrationProvider;
