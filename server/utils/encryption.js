import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// The hardcoded fallback string used in development only.
// This is intentionally weak-sounding so no one uses it in production by accident.
const DEV_FALLBACK_KEY = 'elvis-wms-dev-only-integration-enc-key-do-not-use-in-prod';

/**
 * Derives a 32-byte AES key from the dedicated INTEGRATION_ENCRYPTION_KEY env var.
 *
 * SECURITY RULES:
 *  1. INTEGRATION_ENCRYPTION_KEY MUST be set in production.
 *  2. JWT_SECRET is NOT used as a fallback — key separation is enforced.
 *  3. In NODE_ENV=production with no key, startup throws immediately.
 *  4. In development/test, a clearly-labelled dev fallback is used so
 *     the server still starts but all tokens are encrypted under a known-weak key.
 *
 * @returns {Buffer} 32-byte AES-256 key
 */
function getEncryptionKey() {
  const rawKey = process.env.INTEGRATION_ENCRYPTION_KEY;

  if (!rawKey) {
    if (process.env.NODE_ENV === 'production') {
      // Hard fail in production — this is intentional and cannot be bypassed
      throw new Error(
        '[FATAL] INTEGRATION_ENCRYPTION_KEY environment variable is not set. ' +
        'This key is required for AES-256-GCM token encryption in production. ' +
        'Generate a 64-character hex key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
        'and set it as INTEGRATION_ENCRYPTION_KEY in your environment. ' +
        'DO NOT use JWT_SECRET as a fallback — key separation is required.'
      );
    }
    // Development/test only: use clearly-labelled dev fallback
    // This ensures developers know they need to set this for production
    console.warn(
      '[WARNING] INTEGRATION_ENCRYPTION_KEY is not set. Using development fallback key. ' +
      'Set INTEGRATION_ENCRYPTION_KEY for production deployments.'
    );
    return crypto.createHash('sha256').update(DEV_FALLBACK_KEY).digest();
  }

  // Validate minimum key length (should be at least 32 hex chars = 16 bytes, recommended 64 hex = 32 bytes)
  if (rawKey.length < 32) {
    const msg = `[SECURITY] INTEGRATION_ENCRYPTION_KEY is too short (${rawKey.length} chars, minimum 32). ` +
      'Generate a strong key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    }
    console.warn(msg);
  }

  return crypto.createHash('sha256').update(String(rawKey)).digest();
}

/**
 * Encrypts plaintext string using AES-256-GCM.
 * Output format: hex(iv):hex(authTag):hex(encrypted)
 * @param {string} text - Plaintext to encrypt
 * @returns {string} Encrypted string
 */
export function encrypt(text) {
  if (!text || typeof text !== 'string') return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts encrypted string using AES-256-GCM.
 * @param {string} encryptedText - Encrypted string (iv:authTag:encrypted)
 * @returns {string} Decrypted plaintext string
 */
export function decrypt(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string') return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      // Fallback: return raw value (legacy plaintext or unrecognized format)
      return encryptedText;
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    // Do NOT log the encrypted value or the key
    console.error('[Decryption] AES-256-GCM decryption failed:', err.message);
    return '';
  }
}

/**
 * Validates that the encryption key is properly configured.
 * Call this during application startup.
 * @throws {Error} if in production with missing/weak key
 */
export function validateEncryptionKey() {
  getEncryptionKey(); // Will throw in production if misconfigured
}

export default {
  encrypt,
  decrypt,
  validateEncryptionKey
};
