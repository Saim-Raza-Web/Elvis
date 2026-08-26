import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  txnId: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  description: { type: String, default: '' },
  type: { type: String, enum: ['debit', 'credit'], default: 'debit' }, // 'debit' or 'credit'
  amount: { type: Number, required: true, default: 0 },
  debit: { type: Number, default: 0 },
  credit: { type: Number, default: 0 },
  account: { type: String, required: true },
  category: { type: String, default: 'General' },
  reference: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'posted', 'reversed'], default: 'posted' },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

transactionSchema.index({ company: 1, date: -1 });
transactionSchema.index({ company: 1, account: 1 });
transactionSchema.index({ company: 1, status: 1 });

export default mongoose.model('Transaction', transactionSchema);