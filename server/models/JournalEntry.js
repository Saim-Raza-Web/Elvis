import mongoose from 'mongoose';

const journalLineSchema = new mongoose.Schema({
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

export default mongoose.model('JournalEntry', journalEntrySchema);
