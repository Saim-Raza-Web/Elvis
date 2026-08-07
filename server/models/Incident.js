import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema({
  incidentId: { type: String, required: true },
  type: { type: String, required: true, default: 'Discrepancy' },
  sku: String,
  expectedSKU: String,
  scannedBarcode: String,
  location: String,
  warehouse: String,
  asnReference: String,
  asnId: String,
  supplier: String,
  owner: String,
  operator: String,
  user: String,
  reported_by: String,
  reason: String,
  module: { type: String, default: 'Receiving' },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'open' },
  description: String,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('Incident', incidentSchema);
