import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema({
  incidentId: { type: String, required: true },
  type: { type: String, required: true, enum: ['Discrepancy', 'Damage', 'Incorrect Item', 'QC Rejected', 'QC Partial'] },
  sku: String,
  location: String,
  owner: String,
  reported_by: String,
  status: { type: String, enum: ['open', 'under review', 'resolved'], default: 'open' },
  description: String,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('Incident', incidentSchema);
