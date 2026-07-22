import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  name: String,
  category: String,
  warehouse: { type: String },
  price: Number,
  qty_available: Number,
  qty_reserved: Number,
  qty_blocked: Number,
  qty_ecommerce: Number,
  qty_customer_owned: Number,
  status: String,
  owner: String,
  reorder_point: Number,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Product', productSchema);