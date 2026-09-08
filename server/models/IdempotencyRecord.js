import mongoose from 'mongoose';

const idempotencyRecordSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  idempotencyKey: { type: String, required: true }, // Restore name
  operation: { type: String, required: true },
  
  // Backwards compat fields
  requestFingerprint: { type: String }, 
  responsePayload: { type: mongoose.Schema.Types.Mixed },
  responseStatus: { type: Number },
  
  // Phase 8C.1 Strict Idempotency Fields
  payloadHash: { type: String }, // Optional for older records
  response: { type: mongoose.Schema.Types.Mixed }, // New structured response

  status: {
    type: String,
    enum: ['processing', 'completed', 'failed', 'PENDING', 'COMPLETED', 'FAILED'],
    default: 'processing'
  },
  attempts: { type: Number, default: 0 },
  
  // Lease / Lock fields for atomic recovery of stale PENDING states
  lockedAt: { type: Date },
  lockedUntil: { type: Date },

  createdAt: { type: Date, default: Date.now, expires: 2592000 } // 30 days TTL (financial records should not vanish in 24h if they are idempotency blocks for invoices)
}, { timestamps: true });

// Strict unique identity boundary per company
idempotencyRecordSchema.index({ company: 1, operation: 1, idempotencyKey: 1 }, { unique: true });
// Index for finding stale locks quickly
idempotencyRecordSchema.index({ status: 1, lockedUntil: 1 });

export default mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
