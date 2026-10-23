import mongoose from 'mongoose';

/**
 * ReturnRefund — records a provider-issued refund for a return/RMA.
 *
 * A return status is NEVER set to 'refunded' until the provider confirms the refund.
 * Multiple partial refunds are supported; cumulative total cannot exceed original amount.
 */
const returnRefundSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  returnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', index: true },
  return: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', index: true },
  returnRef: { type: String, default: '' },
  originalAmount: { type: Number, default: 0 },
  requestedAmount: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'EUR' },
  status: {
    type: String,
    enum: ['pending', 'succeeded', 'failed', 'cancelled', 'already_refunded'],
    default: 'pending',
    index: true
  },
  providerRef: { type: String, default: null },
  refundId: { type: String, default: null },
  paymentIntentId: { type: String, default: null },
  providerStatus: { type: String, default: null },
  paymentProvider: { type: String, default: 'stripe' },
  idempotencyKey: { type: String, default: null },
  reason: { type: String, default: '' },
  failureReason: { type: String, default: null },
  processedAt: { type: Date, default: Date.now },
  requestedBy: { type: String, default: 'unknown' },
  auditNote: { type: String, default: '' },
  rawResponse: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

returnRefundSchema.index({ company: 1, returnId: 1, status: 1 });
returnRefundSchema.index({ company: 1, return: 1, status: 1 });
returnRefundSchema.index({ company: 1, idempotencyKey: 1 }, { sparse: true });
returnRefundSchema.index({ providerRef: 1 }, { sparse: true });
returnRefundSchema.index({ refundId: 1 }, { sparse: true });

export default mongoose.model('ReturnRefund', returnRefundSchema);