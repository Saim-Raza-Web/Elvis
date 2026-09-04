import mongoose from 'mongoose';

const siiRecordSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  supplierBillId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierBill' },
  
  recordType: { type: String, enum: ['ISSUED', 'RECEIVED'], required: true },
  
  // Tax mapping
  invoiceNumber: { type: String, required: true },
  invoiceDate: { type: Date, required: true },
  taxPeriod: { type: String, required: true }, // e.g. "2026-09"
  
  counterpartyTaxId: { type: String, required: true }, // Customer or Supplier CIF/NIF
  counterpartyName: { type: String, required: true },
  
  taxBase: { type: Number, required: true },
  taxAmount: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  
  status: {
    type: String,
    enum: ['PENDING', 'SUBMITTING', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'ERROR', 'NOT_CONFIGURED'],
    default: 'PENDING'
  },
  
  aeatResponseCode: { type: String, default: '' },
  aeatResponseDescription: { type: String, default: '' },
  aeatRawResponse: { type: mongoose.Schema.Types.Mixed },
  
  submissionTimestamp: { type: Date },
  
  retryCount: { type: Number, default: 0 },
  lastError: { type: String, default: '' }
}, { timestamps: true });

siiRecordSchema.index({ company: 1, invoiceNumber: 1, recordType: 1 }, { unique: true });
siiRecordSchema.index({ company: 1, status: 1 });
siiRecordSchema.index({ company: 1, taxPeriod: 1 });

export default mongoose.model('SIIRecord', siiRecordSchema);
