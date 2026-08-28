import mongoose from 'mongoose';
import { encrypt, decrypt } from '../utils/encryption.js';

const connectedStoreSchema = new mongoose.Schema({
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true, 
    index: true 
  },
  provider: { 
    type: String, 
    enum: ['SHOPIFY', 'WOOCOMMERCE', 'AMAZON', 'EBAY', 'TEMU', 'MIRAVIA', 'ALIEXPRESS', 'TIKTOK_SHOP'], 
    required: true,
    index: true
  },
  storeName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  customStoreName: {
    type: String,
    default: '',
    trim: true
  },
  storeUrl: { 
    type: String, 
    required: true, 
    trim: true 
  },
  externalStoreId: { 
    type: String, 
    default: '',
    trim: true 
  },
  marketplace: {
    type: String,
    default: '',
    trim: true
  },
  region: {
    type: String,
    default: '',
    trim: true
  },
  country: {
    type: String,
    default: '',
    trim: true
  },
  shopType: {
    type: String,
    default: '',
    trim: true
  },
  connectionMethod: {
    type: String,
    enum: ['oauth_redirect', 'token', 'api_credentials', 'partner_authorization'],
    default: 'oauth_redirect'
  },
  isSandbox: {
    type: Boolean,
    default: false
  },
  status: { 
    type: String, 
    enum: [
      'not_configured', 
      'pending', 
      'pending_authorization', 
      'authorizing', 
      'connected', 
      'sandbox_connected', 
      'syncing', 
      'auth_expired', 
      'error', 
      'disconnected'
    ], 
    default: 'pending',
    index: true
  },

  // ── Encrypted Credentials (AES-256-GCM) ─────────────────
  authType: { 
    type: String, 
    enum: ['OAUTH2', 'API_KEY', 'TOKEN'], 
    default: 'OAUTH2' 
  },
  encryptedAccessToken: { 
    type: String, 
    default: '' 
  },
  encryptedRefreshToken: { 
    type: String, 
    default: '' 
  },
  encryptedClientSecret: { 
    type: String, 
    default: '' 
  },
  encryptedAuthorizationToken: {
    type: String,
    default: ''
  },
  tokenExpiresAt: { 
    type: Date 
  },
  scopes: [{ 
    type: String 
  }],

  // ── Sync Settings ───────────────────────────────────────
  syncSettings: {
    syncProducts: { type: Boolean, default: true },
    syncOrders: { type: Boolean, default: true },
    syncInventory: { type: Boolean, default: true },
    inventoryDirection: { 
      type: String, 
      enum: ['wms_to_store', 'store_to_wms', 'manual_only'], 
      default: 'wms_to_store' 
    },
    autoSyncIntervalMinutes: { type: Number, default: 30 },
    defaultWarehouse: { type: String, default: 'MIA' },
    orderPrefix: { type: String, default: 'ORD-' }
  },

  // ── Synchronization Status & Concurrency Lock ───────────
  isSyncing: { 
    type: Boolean, 
    default: false 
  },
  syncLockExpiresAt: { 
    type: Date 
  },
  lastSyncAt: { 
    type: Date 
  },
  lastSuccessfulSyncAt: { 
    type: Date 
  },
  lastError: { 
    type: String, 
    default: '' 
  },

  // ── Webhook / Integration Metadata ──────────────────────
  webhookSecret: {
    type: String,
    default: ''
  },
  metadata: { 
    type: Map, 
    of: mongoose.Schema.Types.Mixed,
    default: {} 
  },

  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }
}, { 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function (doc, ret) {
      // NEVER leak encrypted or raw tokens to frontend JSON responses
      delete ret.encryptedAccessToken;
      delete ret.encryptedRefreshToken;
      delete ret.encryptedClientSecret;
      delete ret.encryptedAuthorizationToken;
      delete ret.webhookSecret;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Compound indices: Prevent duplicate store connections per company
connectedStoreSchema.index({ company: 1, provider: 1, storeUrl: 1 });
connectedStoreSchema.index({ company: 1, provider: 1, externalStoreId: 1 });
connectedStoreSchema.index({ company: 1, status: 1 });

// Helper methods for token encryption/decryption
connectedStoreSchema.methods.setAccessToken = function(token) {
  this.encryptedAccessToken = token ? encrypt(token) : '';
};

connectedStoreSchema.methods.getAccessToken = function() {
  return this.encryptedAccessToken ? decrypt(this.encryptedAccessToken) : '';
};

connectedStoreSchema.methods.setRefreshToken = function(token) {
  this.encryptedRefreshToken = token ? encrypt(token) : '';
};

connectedStoreSchema.methods.getRefreshToken = function() {
  return this.encryptedRefreshToken ? decrypt(this.encryptedRefreshToken) : '';
};

connectedStoreSchema.methods.setClientSecret = function(secret) {
  this.encryptedClientSecret = secret ? encrypt(secret) : '';
};

connectedStoreSchema.methods.getClientSecret = function() {
  return this.encryptedClientSecret ? decrypt(this.encryptedClientSecret) : '';
};

connectedStoreSchema.methods.setAuthorizationToken = function(token) {
  this.encryptedAuthorizationToken = token ? encrypt(token) : '';
};

connectedStoreSchema.methods.getAuthorizationToken = function() {
  return this.encryptedAuthorizationToken ? decrypt(this.encryptedAuthorizationToken) : '';
};

export default mongoose.model('ConnectedStore', connectedStoreSchema);
