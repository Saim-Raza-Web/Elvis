import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  customer: String,
  email: String,
  channel: String, // fallback or generic channel name
  store_id: { type: mongoose.Schema.Types.ObjectId, ref: 'EcommerceChannel' }, // specific store integration
  order_type: { type: String, enum: ['B2C', 'B2B'], default: 'B2C' },
  warehouse: { type: String },
  items: Number,
  total: Number,
  status: String,
  notes: String,
  date: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);