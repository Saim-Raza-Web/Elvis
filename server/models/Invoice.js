import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceId: { type: String, required: true, unique: true },
  customer: String,
  amount: Number,
  status: String,
  issued: Date,
  due: Date,
  items: Number,
  notes: String,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Invoice', invoiceSchema);