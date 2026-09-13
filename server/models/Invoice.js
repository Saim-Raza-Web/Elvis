import mongoose from 'mongoose';
import { round2 } from '../services/invoiceCalculationEngine.js';

const invoiceLineSchema = new mongoose.Schema({
  itemType: { type: String, enum: ['product', 'service'], default: 'product' },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  sku: { type: String, default: '', trim: true },
  description: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0.001 },
  uom: { type: String, default: 'EA', trim: true },
  unitPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0, max: 100 }, // percentage
  taxRate: { type: Number, default: 21, min: 0 }, // percentage (e.g. 21, 10, 4, 0)
  lineSubtotal: { type: Number, required: true },
  lineTax: { type: Number, required: true },
  lineTotal: { type: Number, required: true }
}, { _id: false });

const invoicePaymentSummarySchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
  paymentNumber: { type: String, required: true, trim: true },
  allocationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  allocatedAmount: { type: Number, required: true, min: 0.01 },
  allocatedAt: { type: Date, default: Date.now, required: true },
  allocatedBy: { type: String, default: 'System' }
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true }, // e.g. INV-2026-00001
  invoiceId: { type: String }, // backward compatibility alias
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerName: { type: String, required: true, trim: true },
  customerEmail: { type: String, default: '', trim: true },
  customerVat: { type: String, default: '', trim: true },
  customerAddress: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  lines: [invoiceLineSchema],
  subtotal: { type: Number, required: true, default: 0 },
  discountTotal: { type: Number, default: 0 },
  totalTax: { type: Number, required: true, default: 0 },
  grandTotal: { type: Number, required: true, default: 0 },
  taxBreakdown: [{
    taxRate: { type: Number, required: true },
    taxableAmount: { type: Number, required: true },
    taxAmount: { type: Number, required: true }
  }],
  status: { 
    type: String, 
    enum: ['draft', 'issued', 'sent', 'partially_paid', 'paid', 'cancelled'], 
    default: 'draft' 
  },
  amountPaid: { 
    type: Number, 
    default: 0,
    min: 0 
  },
  outstandingAmount: { 
    type: Number, 
    default: function() {
      if (this.historicalReconciliationState === 'MANUAL_REVIEW_REQUIRED') return null;
      if (this.status === 'cancelled') return 0;
      return this.grandTotal !== undefined ? this.grandTotal : 0;
    }
  },
  payments: [invoicePaymentSummarySchema],
  currency: { 
    type: String, 
    default: 'EUR',
    enum: ['EUR']
  },
  issuedDate: { type: Date, default: Date.now },
  dueDate: { type: Date },
  paymentTerms: { type: String, default: 'Net 30' },
  notes: { type: String, default: '' },
  bankInfo: { type: String, default: '' },
  items: { type: Number, default: 1 }, // backward compatibility
  amount: { type: Number, default: 0 }, // backward compatibility alias for grandTotal
  customer: { type: String }, // backward compatibility string
  sentAt: { type: Date },
  sentTo: { type: String },
  sentBy: { type: String },
  emailHistory: [{
    sentAt: { type: Date, default: Date.now },
    sentTo: String,
    status: String,
    error: String
  }],
  accountingTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  accountingJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  reversedAt: { type: Date, default: null },
  reversedBy: { type: String, default: null },
  reversalReason: { type: String, default: '' },
  reversalJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  historicalReconciliationState: { 
    type: String, 
    enum: ['LEGACY_UNVERIFIED', 'MANUAL_REVIEW_REQUIRED', null], 
    default: null 
  },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  shipments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// Schema-level protection & Invariant Hooks
invoiceSchema.pre('save', function() {
  if (typeof this.amountPaid === 'number') {
    this.amountPaid = round2(this.amountPaid);
  }
  if (typeof this.outstandingAmount === 'number') {
    this.outstandingAmount = round2(this.outstandingAmount);
  }
  if (Array.isArray(this.payments)) {
    for (const p of this.payments) {
      if (typeof p.allocatedAmount === 'number') {
        p.allocatedAmount = round2(p.allocatedAmount);
      }
    }
  }

  // Cancelled invoice balances must strictly be zero
  if (this.status === 'cancelled') {
    this.amountPaid = 0;
    this.outstandingAmount = 0;
  } else if (this.historicalReconciliationState === 'MANUAL_REVIEW_REQUIRED') {
    this.outstandingAmount = null;
  } else {
    if (this.amountPaid !== null && this.amountPaid !== undefined && this.amountPaid < 0) {
      throw new Error('Invoice amountPaid cannot be negative.');
    }
    if (this.outstandingAmount !== null && this.outstandingAmount !== undefined && this.outstandingAmount < 0) {
      throw new Error('Invoice outstandingAmount cannot be negative.');
    }
  }
});

invoiceSchema.index({ company: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ company: 1, customerId: 1 });
invoiceSchema.index({ company: 1, status: 1 });
invoiceSchema.index({ company: 1, issuedDate: -1 });
invoiceSchema.index({ company: 1, historicalReconciliationState: 1 });
invoiceSchema.index({ company: 1, 'payments.allocationId': 1 });

export default mongoose.model('Invoice', invoiceSchema);