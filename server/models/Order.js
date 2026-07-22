import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  customer: String,
  email: String,
  channel: String,
  warehouse: { type: String },
  items: Number,
  total: Number,
  status: String,
  notes: String,
  date: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);