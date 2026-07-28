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
  owner: String,
  items: [{
    sku: String,
    expected_qty: Number,
    received_qty: { type: Number, default: 0 },
    qc_status: { type: String, enum: ['pending', 'approved', 'partial', 'rejected'], default: 'pending' },
    notes: String
  }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('ASN', asnSchema);