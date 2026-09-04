import mongoose from 'mongoose';

const verifactuRecordSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  supplierBillId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierBill' },
  
  recordType: { type: String, enum: ['ISSUED', 'RECEIVED'], required: true },
  
  // Tax details for the hash
  invoiceNumber: { type: String, required: true },
  issueDate: { type: Date, required: true },
  issuerTaxId: { type: String, required: true },
  totalAmount: { type: Number, required: true },
  taxAmount: { type: Number, required: true },
  
  // Hash chaining for immutability
  previousRecordHash: { type: String, default: null }, // Null for the very first record
  currentHash: { type: String, required: true },
  
  status: {
    type: String,
    enum: ['PENDING', 'SUBMITTING', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'ERROR'],
    default: 'PENDING'
  },
  
  aeatResponseCode: { type: String, default: '' },
  aeatResponseDescription: { type: String, default: '' },
  aeatRawResponse: { type: mongoose.Schema.Types.Mixed }, // Full JSON or XML response if needed
  
  submissionTimestamp: { type: Date },
  
  retryCount: { type: Number, default: 0 },
  lastError: { type: String, default: '' }
}, { timestamps: true });

verifactuRecordSchema.index({ company: 1, invoiceNumber: 1 }, { unique: true });
verifactuRecordSchema.index({ company: 1, status: 1 });
verifactuRecordSchema.index({ company: 1, recordType: 1, createdAt: 1 });

export default mongoose.model('VeriFactuRecord', verifactuRecordSchema);
