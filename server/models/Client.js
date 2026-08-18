import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  vat: { type: String, default: '' },
  contact: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  warehouseAccess: { type: [String], default: ['MIA'] },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

clientSchema.index({ company: 1, name: 1 }, { unique: true });

export default mongoose.model('Client', clientSchema);
