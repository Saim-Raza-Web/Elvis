import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  contact: { type: String, default: '', trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, default: '', trim: true },
  vatNumber: { type: String, default: '', trim: true }, // Tax / VAT / CIF / NIF ID
  country: { type: String, default: 'Spain', trim: true },
  billingAddress: {
    street: { type: String, default: '' },
    number: { type: String, default: '' },
    city: { type: String, default: '' },
    postcode: { type: String, default: '' },
    region: { type: String, default: '' },
    country: { type: String, default: 'Spain' }
  },
  shippingAddress: {
    street: { type: String, default: '' },
    number: { type: String, default: '' },
    city: { type: String, default: '' },
    postcode: { type: String, default: '' },
    region: { type: String, default: '' },
    country: { type: String, default: 'Spain' }
  },
  paymentTerms: { type: String, default: 'Net 30' }, // Net 15, Net 30, Net 60, Due on Receipt
  iban: { type: String, default: '', trim: true },
  bankInfo: { type: String, default: '', trim: true },
  tier: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
  notes: { type: String, default: '' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  active: { type: Boolean, default: true },
  orders: { type: Number, default: 0 },
  total_spend: { type: Number, default: 0 },
  last_activity: { type: Date, default: Date.now },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

customerSchema.index({ company: 1, name: 1 });
customerSchema.index({ company: 1, email: 1 });
customerSchema.index({ company: 1, vatNumber: 1 });

export default mongoose.model('Customer', customerSchema);