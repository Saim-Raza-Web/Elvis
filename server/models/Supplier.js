import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  name: { type: String, required: true },
  taxId: { type: String, default: '' },
  country: { type: String, default: 'Spain' },
  contact: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  defaultCarrier: { type: String, default: '' },
  leadTime: { type: Number, default: 7 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

supplierSchema.index({ company: 1, name: 1 }, { unique: true });

export default mongoose.model('Supplier', supplierSchema);
