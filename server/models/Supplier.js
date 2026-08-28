import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  street: { type: String, default: '', trim: true },
  number: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  postcode: { type: String, default: '', trim: true },
  region: { type: String, default: '', trim: true },
  country: { type: String, default: 'Spain', trim: true }
}, { _id: false });

const supplierSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  supplierType: { 
    type: String, 
    enum: ['Vendor', 'Manufacturer', 'Wholesaler', 'Distributor', 'Service Provider', 'Logistics / Carrier', 'Other'],
    default: 'Vendor'
  },
  contact: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true },
  phone: { type: String, default: '', trim: true },
  website: { type: String, default: '', trim: true },
  
  // Tax & Business Info
  taxId: { type: String, default: '', trim: true }, // CIF / NIF / VAT ID
  country: { type: String, required: true, default: 'Spain', trim: true },
  taxRegistrationNotes: { type: String, default: '', trim: true },
  
  // Addresses
  billingAddress: { type: addressSchema, default: () => ({}) },
  shippingAddress: { type: addressSchema, default: () => ({}) },
  
  // Payment Info
  paymentInfo: {
    defaultPaymentTerms: { type: String, default: 'Net 30', trim: true },
    iban: { type: String, default: '', trim: true },
    bankName: { type: String, default: '', trim: true },
    swiftBic: { type: String, default: '', trim: true },
    paymentNotes: { type: String, default: '', trim: true }
  },

  // Accounting & Chart of Accounts Linkage
  accountingInfo: {
    ledgerAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    accountCode: { type: String, default: '', trim: true }, // e.g. "400.000.001"
    accountName: { type: String, default: '', trim: true } // e.g. "Bag Supplier"
  },

  // Logistics & Operations
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
supplierSchema.index({ company: 1, 'accountingInfo.accountCode': 1 });
supplierSchema.index({ company: 1, preferredForOwner: 1 });

export default mongoose.model('Supplier', supplierSchema);
