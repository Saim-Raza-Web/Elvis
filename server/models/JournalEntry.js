import mongoose from 'mongoose';

/**
 * JournalEntry — Double-entry accounting ledger record.
 *
 * PRODUCTION HARDENING (2026-08-28):
 * - journalLineSchema now includes `accountId` (ChartOfAccount ObjectId) as the
 *   authoritative relational key. `account` string is retained as a snapshot
 *   for display/history only. Renaming a CoA account does NOT break history.
 * - `accountCodeSnapshot` and `accountNameSnapshot` explicitly stored so
 *   historical display works even if the CoA account is later renamed.
 */
const journalLineSchema = new mongoose.Schema({
  // Stable ObjectId reference — authoritative relational key
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null  // null for legacy entries created before this migration
  },
  // Snapshot of account code at time of posting (immutable display field)
  accountCodeSnapshot: { type: String, default: '', trim: true },
  // Snapshot of account name at time of posting (immutable display field)
  accountNameSnapshot: { type: String, default: '', trim: true },
  // Legacy/display field: "accountCode - accountName" or plain name
  // Kept for backward compat but must NOT be used as relational key
  account: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  debit: { type: Number, default: 0, min: 0 },
  credit: { type: Number, default: 0, min: 0 }
}, { _id: false });

const journalEntrySchema = new mongoose.Schema({
  entryNumber: { type: String, required: true }, // e.g. JE-2026-00001
  date: { type: Date, default: Date.now, required: true },
  reference: { type: String, default: '', trim: true },
  description: { type: String, required: true, trim: true },
  entryType: {
    type: String,
    enum: ['manual', 'supplier_bill', 'customer_invoice', 'payment', 'reversal'],
    default: 'manual'
  },
  sourceDocument: {
    docType: { type: String, enum: ['supplier_bill', 'customer_invoice', 'payment', 'manual', 'other'], default: 'manual' },
    docId: { type: mongoose.Schema.Types.ObjectId },
    docNumber: { type: String, default: '' }
  },
  lines: [journalLineSchema],
  totalDebit: { type: Number, required: true, default: 0 },
  totalCredit: { type: Number, required: true, default: 0 },
  status: {
    type: String,
    enum: ['draft', 'posted', 'reversed'],
    default: 'posted'
  },
  postedAt: { type: Date },
  postedBy: { type: String, default: 'System' },
  reversedAt: { type: Date },
  reversedBy: { type: String },
  reversalReason: { type: String, default: '' },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  notes: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

journalEntrySchema.index({ company: 1, entryNumber: 1 }, { unique: true });
journalEntrySchema.index({ company: 1, date: -1 });
journalEntrySchema.index({ company: 1, status: 1 });
journalEntrySchema.index({ company: 1, 'sourceDocument.docNumber': 1 });
// Index for ObjectId-based account lookups
journalEntrySchema.index({ company: 1, 'lines.accountId': 1 });

export default mongoose.model('JournalEntry', journalEntrySchema);
