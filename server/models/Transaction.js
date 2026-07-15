import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  txnId: { type: String, required: true, unique: true },
  date: Date,
  description: String,
  type: String,
  amount: Number,
  account: String,
  category: String,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Transaction', transactionSchema);