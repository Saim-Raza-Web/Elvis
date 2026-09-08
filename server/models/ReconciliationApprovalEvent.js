import mongoose from 'mongoose';

const reconciliationApprovalEventSchema = new mongoose.Schema({
  company: { type: String, required: true },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
  action: { type: String, enum: ['APPROVE', 'REJECT', 'REVOKE'], required: true },
  performedBy: { type: String, required: true },
  performedAt: { type: Date, default: Date.now, required: true },
  notes: { type: String, default: '' }
}, {
  timestamps: { createdAt: true, updatedAt: false } // Immutable
});

reconciliationApprovalEventSchema.index({ company: 1, journalEntryId: 1, performedAt: 1 });

const ReconciliationApprovalEvent = mongoose.model('ReconciliationApprovalEvent', reconciliationApprovalEventSchema);

export default ReconciliationApprovalEvent;
