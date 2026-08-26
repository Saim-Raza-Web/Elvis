import mongoose from 'mongoose';

const billLineSchema = new mongoose.Schema({
  expenseAccount: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, default: 1, min: 0.001 },
  uom: { type: String, default: 'EA', trim: true },
  unitPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0, max: 100 }, // percentage
  taxRate: { type: Number, default: 21, min: 0 }, // percentage (e.g. 21, 10, 4, 0)
  lineSubtotal: { type: Number, required: true },
  lineTax: { type: Number, required: true },
  lineTotal: { type: Number, required: true }
}, { _id: false });

const billPaymentSchema = new mongoose.Schema({
  paymentNumber: { type: String, required: true },
  date: { type: Date, default: Date.now },
  amount: { type: Number, required: true, min: 0.01 },
  paymentMethod: { type: String, default: 'Bank Transfer' },
  paymentAccount: { type: String, default: 'Cash & Cash Equivalents' },
  reference: { type: String, default: '' },
  notes: { type: String, default: '' },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  recordedBy: { type: String, default: 'System' }
}, { _id: true, timestamps: true });

const supplierBillSchema = new mongoose.Schema({
  billNumber: { type: String, required: true }, // e.g. BILL-2026-00001
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  supplierName: { type: String, required: true, trim: true },
  supplierTaxId: { type: String, default: '', trim: true },
  supplierEmail: { type: String, default: '', trim: true },
  supplierInvoiceNumber: { type: String, required: true, trim: true }, // Supplier's invoice / ref number
  billDate: { type: Date, default: Date.now, required: true },
  dueDate: { type: Date },
  paymentTerms: { type: String, default: 'Net 30' },
  currency: { type: String, default: 'EUR' },
  lines: [billLineSchema],
  subtotal: { type: Number, required: true, default: 0 },
  discountTotal: { type: Number, default: 0 },
  totalTax: { type: Number, required: true, default: 0 },
  grandTotal: { type: Number, required: true, default: 0 },
  taxBreakdown: [{
    taxRate: { type: Number, required: true },
    taxableAmount: { type: Number, required: true },
    taxAmount: { type: Number, required: true }
  }],
  amountPaid: { type: Number, default: 0 },
  outstandingAmount: { type: Number, required: true, default: 0 },
  status: {
    type: String,
    enum: ['draft', 'posted', 'partially_paid', 'paid', 'reversed'],
    default: 'draft'
  },
  postedAt: { type: Date },
  postedBy: { type: String },
  reversedAt: { type: Date },
  reversedBy: { type: String },
  reversalReason: { type: String, default: '' },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  reversalJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  payments: [billPaymentSchema],
  notes: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

supplierBillSchema.index({ company: 1, billNumber: 1 }, { unique: true });
supplierBillSchema.index({ company: 1, supplierId: 1, supplierInvoiceNumber: 1 });
supplierBillSchema.index({ company: 1, status: 1 });
supplierBillSchema.index({ company: 1, billDate: -1 });

export default mongoose.model('SupplierBill', supplierBillSchema);
