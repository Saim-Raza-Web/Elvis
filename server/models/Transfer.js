import mongoose from 'mongoose';

const transferSchema = new mongoose.Schema({
  transferId: { type: String, required: true, unique: true },
  sku: String,
  product: String,
  qty: Number,
  from_wh: String,
  from_loc: String,
  to_wh: String,
  to_loc: String,
  status: String,
  type: String,
  requestedBy: String,
  date: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Transfer', transferSchema);