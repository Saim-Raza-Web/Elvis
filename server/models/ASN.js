import mongoose from 'mongoose';

const asnSchema = new mongoose.Schema({
  asnId: { type: String, required: true, unique: true },
  supplier: String,
  origin: String,
  carrier: String,
  sku_count: Number,
  expected_units: Number,
  status: String,
  expected_date: Date,
  po: String,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('ASN', asnSchema);