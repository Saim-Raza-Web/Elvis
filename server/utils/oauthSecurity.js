import crypto from 'crypto';
import OAuthNonce from '../models/OAuthNonce.js';

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes state validity
const NONCE_TTL_MINUTES = 30; // 30 minutes nonce persistence in DB

/**
 * Returns the HMAC signing secret for OAuth state tokens.
 * Uses OAUTH_HMAC_SECRET if set, otherwise JWT_SECRET.
 * JWT signing and OAuth signing are now explicitly separate concerns.
 */
function getSigningSecret() {
  const secret = process.env.OAUTH_HMAC_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      '[FATAL] Neither OAUTH_HMAC_SECRET nor JWT_SECRET is set. ' +
      'At least one must be configured to sign OAuth state tokens.'
    );
  }
  return secret;
}

/**
 * Generates a signed, URL-safe OAuth state token.
 * Payload includes companyId, userId, provider, random nonce, and creation timestamp.
 *
 * The nonce is persisted to MongoDB (OAuthNonce collection) with TTL expiry.
 * This ensures replay protection works across multiple application instances.
 *
 * Format: base64url(payloadJSON).base64url(hmacSignature)
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} [params.userId]
 * @param {string} params.provider
 * @param {string} [params.redirectUri]
 * @param {object} [params.extra]
 * @returns {Promise<string>} Signed state token
 */
export async function generateOAuthState({ companyId, userId, provider, redirectUri, extra = {} }) {
  if (!companyId || !provider) {
    throw new Error('companyId and provider are required to generate OAuth state');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60 * 1000);

  // Persist nonce to MongoDB with TTL — works across all process instances
  await OAuthNonce.create({
    nonce,
    companyId: String(companyId),
    provider: String(provider).toUpperCase(),
    userId: userId ? String(userId) : '',
    expiresAt
  });

  const payload = {
    c: String(companyId),
    u: userId ? String(userId) : null,
    p: String(provider).toUpperCase(),
    r: redirectUri || null,
    n: nonce,
    t: Date.now(),
    x: extra
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadStr)
    .digest('base64url');

  return `${payloadStr}.${signature}`;
}

/**
 * Validates and decodes an OAuth state token.
 *
 * Verifies:
 *  1. HMAC signature (tamper detection)
 *  2. Timestamp expiration (15-minute window)
 *  3. Single-use nonce (replay prevention via DB atomic findOneAndDelete)
 *
 * The nonce is atomically consumed from MongoDB — concurrent requests racing
 * on the same callback will only have one succeed; all others are rejected.
 *
 * @param {string} state - The raw state query param received in callback
 * @returns {Promise<object>} { isValid: boolean, payload: object, error: string }
 */
export async function validateOAuthState(state) {
  if (!state || typeof state !== 'string') {
    return { isValid: false, payload: null, error: 'Missing or invalid state parameter' };
  }

  const parts = state.split('.');
  if (parts.length !== 2) {
    return { isValid: false, payload: null, error: 'Malformed state token structure' };
  }

  const [payloadStr, signature] = parts;

  // 1. Verify HMAC Signature (timing-safe)
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadStr)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return { isValid: false, payload: null, error: 'Invalid state signature (tampering detected)' };
  }

  // 2. Decode payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
  } catch (err) {
    return { isValid: false, payload: null, error: 'Failed to parse state payload JSON' };
  }

  // 3. Expiration Check (15-minute window)
  const age = Date.now() - (payload.t || 0);
  if (age < 0 || age > STATE_TTL_MS) {
    return { isValid: false, payload, error: `OAuth state expired (${Math.round(age / 1000)}s old > 900s limit)` };
  }

  // 4. Single-use Nonce verification (DB-backed, works across multiple instances)
  // findOneAndDelete is atomic — only one caller wins; all others get null
  if (payload.n) {
    const nonceDoc = await OAuthNonce.findOneAndDelete({
      nonce: payload.n,
      expiresAt: { $gt: new Date() } // Extra safety: reject already-expired DB nonces
    });

    if (!nonceDoc) {
      return {
        isValid: false,
        payload,
        error: 'OAuth state nonce has already been used or expired (replay attack detected)'
      };
    }
  }

  return {
    isValid: true,
    payload: {
      companyId: payload.c,
      userId: payload.u,
      provider: payload.p,
      redirectUri: payload.r,
      nonce: payload.n,
      timestamp: payload.t,
      extra: payload.x || {}
    },
    error: null
  };
}

export default {
  generateOAuthState,
  validateOAuthState
};
