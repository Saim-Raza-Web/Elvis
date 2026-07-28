import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  code: { type: String, required: true },
  warehouse: { type: String, required: true },
  zone: { type: String }, // Storing zone name or code directly instead of ref for simplicity
  aisle: String,
  shelf: String,
  bin: String,
  sku: { type: String }, // Storing SKU string instead of ref for simplicity
  qty: { type: Number, default: 0 },
  capacity: Number,
  status: String,
  allowed_manufacturers: [String], // Storage rule: which brands can go here
  allowed_families: [String], // Storage rule: which categories can go here
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('Location', locationSchema);