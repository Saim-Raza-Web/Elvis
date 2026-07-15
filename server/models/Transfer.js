import mongoose from 'mongoose';

const transferSchema = new mongoose.Schema({
  transferId: { type: String, required: true, unique: true },
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  product: String,
  qty: Number,
  from_wh: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  from_loc: String,
  to_wh: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  to_loc: String,
  status: String,
  type: String,
  requestedBy: String,
  date: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Transfer', transferSchema);