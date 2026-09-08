import mongoose from 'mongoose';

const complianceOutboxEventSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  eventType: { type: String, required: true }, // e.g., 'INVOICE_ISSUE', 'PAYMENT_RECEIPT'
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true }, // e.g., Invoice ID
  referenceType: { type: String, required: true }, // 'Invoice', 'Payment'
  payload: { type: mongoose.Schema.Types.Mixed }, // Structured data for the compliance engine
  
  // Idempotency constraint per business event to prevent duplicate outbox entries for the same action
  idempotencyKey: { type: String, required: true }, 

  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    required: true
  },
  
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  lastError: { type: String },

  // Lock for atomic worker processing
  lockedUntil: { type: Date }
}, { timestamps: true });

// Prevent duplicate compliance events for the same business action
complianceOutboxEventSchema.index({ company: 1, eventType: 1, idempotencyKey: 1 }, { unique: true });

// Optimize worker polling for events ready to be processed
complianceOutboxEventSchema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 });

export default mongoose.model('ComplianceOutboxEvent', complianceOutboxEventSchema);
