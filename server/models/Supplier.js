import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  name: { type: String, required: true },
  taxId: { type: String, default: '' },
  country: { type: String, required: true, default: 'Spain' },
  contact: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  defaultCarrier: { type: String, default: '' },
  preferredCarrier: { type: String, default: '' },
  preferredForOwner: { type: String, default: '' },
  leadTime: { type: Number, default: 7 },
  notes: { type: String, default: '' },
  active: { type: Boolean, default: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

supplierSchema.pre('save', function () {
  if (this.preferredCarrier && !this.defaultCarrier) this.defaultCarrier = this.preferredCarrier;
  if (this.defaultCarrier && !this.preferredCarrier) this.preferredCarrier = this.defaultCarrier;
});

supplierSchema.index({ company: 1, name: 1 }, { unique: true });
supplierSchema.index({ company: 1, preferredForOwner: 1 });

export default mongoose.model('Supplier', supplierSchema);
