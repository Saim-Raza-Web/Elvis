import mongoose from 'mongoose';
import crypto from 'crypto';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  role: { type: String, default: 'warehouse_staff' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  warehouses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' }],
  // TOTP fields
  totpSecret: { type: String }, // Encrypted TOTP secret
  totpEnabled: { type: Boolean, default: false },
  totpRecoveryCodes: [{ type: String }], // Hashed recovery codes
  totpSetupPending: { type: Boolean, default: false }, // Pending verification of new secret
  totpLastUsed: { type: String } // Last successfully used TOTP code (to prevent replay)
}, { timestamps: true });

userSchema.index({ company: 1, role: 1 });
userSchema.index({ company: 1, clientId: 1 });
userSchema.index({ company: 1, warehouses: 1 });

/**
 * Get encryption key with validation
 * Fails securely in production if key is missing
 */
function getEncryptionKey() {
  const key = process.env.TOTP_ENCRYPTION_KEY;
  
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] TOTP_ENCRYPTION_KEY environment variable is not configured in production');
    }
    // In development, generate a warning but use a consistent key
    console.warn('[WARNING] TOTP_ENCRYPTION_KEY not set. Using development key. DO NOT USE IN PRODUCTION.');
    return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  }
  
  // Validate key is 32 bytes (64 hex characters)
  if (key.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('[FATAL] TOTP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }
  
  return key;
}

/**
 * Encrypt sensitive data using AES-256-GCM
 */
function encrypt(text) {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(getEncryptionKey(), 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt sensitive data
 */
function decrypt(encryptedText) {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(getEncryptionKey(), 'hex');
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

userSchema.methods.setTotpSecret = function(secret) {
  this.totpSecret = encrypt(secret);
};

userSchema.methods.getTotpSecret = function() {
  if (!this.totpSecret) return '';
  return decrypt(this.totpSecret);
};

const User = mongoose.model('User', userSchema);

export default User;