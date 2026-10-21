import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import AuditLog from '../models/AuditLog.js';

/**
 * TOTP Service for Two-Factor Authentication
 * Handles TOTP secret generation, QR code creation, and code verification
 */

/**
 * Generate a new TOTP secret
 */
export function generateTotpSecret() {
  return generateSecret();
}

/**
 * Generate a provisioning URI for QR code
 */
export function generateProvisioningUri(email, secret, issuer = 'Elvis WMS') {
  return generateURI({
    issuer,
    label: email,
    secret
  });
}

/**
 * Generate QR code as data URL
 */
export async function generateQrCode(provisioningUri) {
  try {
    return await QRCode.toDataURL(provisioningUri, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Verify TOTP code
 * Uses timing-safe comparison and replay prevention
 */
export async function verifyTotpCode(token, secret, lastUsed = null) {
  if (!token || !secret) {
    return { valid: false, message: 'Invalid token or secret' };
  }

  // Prevent replay of the same code
  if (lastUsed && lastUsed === token) {
    return { valid: false, message: 'Code already used' };
  }

  // Using otplib's verify method with strict validation (window: 0)
  try {
    const isValid = await verify({ token, secret, window: 0 });
    if (isValid) {
      return { valid: true, message: 'Code verified' };
    }
  } catch (error) {
    // otplib may throw on invalid codes
  }

  return { valid: false, message: 'Invalid code' };
}

/**
 * Generate secure recovery codes
 * Returns 10 single-use codes
 */
export function generateRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash recovery codes for storage
 */
export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Verify recovery code
 */
export function verifyRecoveryCode(code, hashedCodes) {
  const hashedInput = hashRecoveryCode(code);
  const index = hashedCodes.indexOf(hashedInput);
  
  if (index === -1) {
    return { valid: false, message: 'Invalid recovery code' };
  }

  return { valid: true, message: 'Recovery code accepted', index };
}

/**
 * Log TOTP audit event
 * Reliably persists event to AuditLog collection with actor and company scoping.
 * Strips sensitive credentials to prevent credential leakage in audit records.
 */
export async function logTotpEvent(userId, company, eventType, metadata = {}) {
  // Strip any sensitive credentials that might inadvertently be passed
  const SENSITIVE_KEYS = new Set([
    'password', 'secret', 'token', 'challengeToken', 'code', 'recoveryCodes', 'key', 'otp', 'totpSecret'
  ]);
  const sanitizedMetadata = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    if (!SENSITIVE_KEYS.has(k)) {
      sanitizedMetadata[k] = v;
    }
  }

  try {
    const doc = {
      event_id: `TOTP-${eventType}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      event_type: `totp_${eventType}`,
      user_id: userId,
      company,
      new_value: sanitizedMetadata,
      reason_text: sanitizedMetadata.reason || ''
    };
    if (sanitizedMetadata.userName) {
      doc.user_name = sanitizedMetadata.userName;
    }

    const auditEntry = await AuditLog.create(doc);
    return auditEntry;
  } catch (error) {
    console.error(`[AUDIT_LOG_ERROR] Failed to persist TOTP audit event 'totp_${eventType}':`, error.message);
    return null;
  }
}

import {
  checkRateLimit as checkRateLimitDistributed,
  clearRateLimit as clearRateLimitDistributed,
  onSuccessfulVerification as onSuccessfulVerificationDistributed
} from './totpRateLimiter.js';

/**
 * Rate limit TOTP verification attempts using distributed atomic sliding window
 */
export async function checkRateLimit(userId, req = null, options = {}) {
  let requestObj = null;
  let customOptions = {};
  if (req && typeof req === 'object' && (req.headers || req.ip || req.socket)) {
    requestObj = req;
    customOptions = options || {};
  } else if (typeof req === 'number') {
    // Legacy signature: checkRateLimit(userId, maxAttempts, windowMs)
    customOptions.maxAttempts = req;
    if (typeof options === 'number') {
      customOptions.windowSeconds = Math.ceil(options / 1000);
    }
  }
  return checkRateLimitDistributed(userId, requestObj, customOptions);
}

export async function clearRateLimit(userId, req = null) {
  return clearRateLimitDistributed(userId, req);
}

export async function onSuccessfulVerification(userId, req = null, memberId = null) {
  return onSuccessfulVerificationDistributed(userId, req, memberId);
}
