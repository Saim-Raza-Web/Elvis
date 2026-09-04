import mongoose from 'mongoose';

const idempotencyRecordSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  idempotencyKey: { type: String, required: true },
  operation: { type: String, required: true },
  requestFingerprint: { type: String }, // hash of body/params to prevent same key + diff body
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing'
  },
  responsePayload: { type: mongoose.Schema.Types.Mixed },
  responseStatus: { type: Number },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // 24H TTL
}, { timestamps: true });

// Prevent cross-company and cross-operation collisions, ensure global idempotency
idempotencyRecordSchema.index({ company: 1, idempotencyKey: 1, operation: 1 }, { unique: true });

export default mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
