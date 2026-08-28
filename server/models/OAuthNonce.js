import mongoose from 'mongoose';

/**
 * OAuthNonce — Persistent single-use OAuth state nonce store.
 *
 * Replaces the in-memory Set in oauthSecurity.js with a MongoDB TTL collection
 * that works correctly across multiple application instances (horizontal scaling).
 *
 * Nonces are:
 *  - bound to company + provider + flow
 *  - single-use (consumed atomically via findOneAndDelete)
 *  - auto-expired by MongoDB TTL index after 30 minutes
 *  - unique indexed to prevent race condition double-use
 */
const oauthNonceSchema = new mongoose.Schema({
  nonce: {
    type: String,
    required: true,
    index: { unique: true }
  },
  companyId: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    default: ''
  },
  // TTL field: MongoDB will auto-delete documents 30 minutes after creation
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index: delete when expiresAt is reached
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export default mongoose.model('OAuthNonce', oauthNonceSchema);
