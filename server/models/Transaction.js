import mongoose from 'mongoose';

/**
 * Transaction — General ledger transaction record.
 *
 * PRODUCTION HARDENING (2026-08-28):
 * - Added `accountId` (ChartOfAccount ObjectId) as the authoritative reference.
 * - `account` string retained as display snapshot only.
 * - Balance queries MUST prefer accountId when available; fall back to name for legacy.
 */
const transactionSchema = new mongoose.Schema({
  txnId: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  description: { type: String, default: '' },
  type: { type: String, enum: ['debit', 'credit'], default: 'debit' },
  amount: { type: Number, required: true, default: 0 },
  debit: { type: Number, default: 0 },
  credit: { type: Number, default: 0 },
  // Legacy display field — NOT the authoritative relational key
  account: { type: String, required: true },
  // Stable ObjectId reference — authoritative relational key
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  // Immutable snapshot of code/name at posting time
  accountCodeSnapshot: { type: String, default: '' },
  accountNameSnapshot: { type: String, default: '' },
  category: { type: String, default: 'General' },
  reference: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'posted', 'reversed'], default: 'posted' },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

transactionSchema.index({ company: 1, date: -1 });
transactionSchema.index({ company: 1, account: 1 });
transactionSchema.index({ company: 1, accountId: 1 }); // New index for ObjectId-based balance queries
transactionSchema.index({ company: 1, status: 1 });

export default mongoose.model('Transaction', transactionSchema);