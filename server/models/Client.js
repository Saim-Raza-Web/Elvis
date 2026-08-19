import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  vat: { type: String, default: '' },
  country: { type: String, default: 'Spain' },
  contact: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  notes: { type: String, default: '' },
  active: { type: Boolean, default: true },
  warehouseAccess: { type: [String], default: ['MIA'] },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

clientSchema.index({ company: 1, name: 1 }, { unique: true });
clientSchema.index({ company: 1, vat: 1 }, { sparse: true });

export default mongoose.model('Client', clientSchema);
