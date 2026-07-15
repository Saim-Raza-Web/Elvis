import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  code: { type: String, required: true },
  zone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  aisle: String,
  shelf: String,
  bin: String,
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  qty: Number,
  capacity: Number,
  status: String
}, { timestamps: true });

export default mongoose.model('Location', locationSchema);