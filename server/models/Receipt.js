import mongoose from 'mongoose';

const receiptSchema = new mongoose.Schema({
  receiptId: { type: String, required: true, unique: true },
  asn: { type: mongoose.Schema.Types.ObjectId, ref: 'ASN' },
  sku: String,
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  expected: Number,
  received: Number,
  discrepancy: Number,
  condition: String,
  zone: String,
  timestamp: Date
}, { timestamps: true });

export default mongoose.model('Receipt', receiptSchema);