import mongoose from 'mongoose';

const discrepancySchema = new mongoose.Schema({
  discrepancyId: { type: String, required: true },
  asnId: { type: String, required: true },
  asnNumber: { type: String },
  sku: { type: String, required: true },
  type: {
    type: String,
    enum: ['over_receiving', 'under_receiving', 'damaged', 'unexpected_sku'],
    required: true
  },
  expectedQty: { type: Number, default: 0 },
  receivedQty: { type: Number, default: 0 },
  damagedQty: { type: Number, default: 0 },
  difference: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  user: { type: String, default: 'system' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('Discrepancy', discrepancySchema);
