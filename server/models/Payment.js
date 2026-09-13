import mongoose from 'mongoose';
import { round2 } from '../services/invoiceCalculationEngine.js';

/**
 * Payment Allocation Subdocument Schema
 * Represents a discrete, stable application of payment funds to an invoice.
 */
const paymentAllocationSchema = new mongoose.Schema({
  allocationId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true, 
    default: () => new mongoose.Types.ObjectId() 
  },
  invoiceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Invoice', 
    required: true 
  },
  invoiceNumber: { 
    type: String, 
    required: true, 
    trim: true 
  },
  previousInvoiceStatus: { 
    type: String, 
    required: true, 
    enum: ['issued', 'sent', 'partially_paid'] 
  },
  allocatedAmount: { 
    type: Number, 
    required: true, 
    min: 0.01 
  },
  allocatedAt: { 
    type: Date, 
    default: Date.now, 
    required: true 
  },
  allocatedBy: { 
    type: String, 
    default: 'System' 
  },
  journalEntryId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'JournalEntry',
    default: null
  },
  isReversed: { 
    type: Boolean, 
    default: false 
  },
  reversedAt: { 
    type: Date, 
    default: null 
  },
  reversedBy: { 
    type: String, 
    default: null 
  },
  reversalJournalEntryId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'JournalEntry', 
    default: null 
  },
  reversalReason: { 
    type: String, 
    default: '' 
  }
}, { _id: false });

/**
 * Payment Schema
 * First-class financial document recording customer monetary receipts and allocations.
 */
const paymentSchema = new mongoose.Schema({
  paymentNumber: { 
    type: String, 
    required: true, 
    trim: true 
  },
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true, 
    index: true 
  },
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer', 
    required: true, 
    index: true 
  },
  customerNameSnapshot: { 
    type: String, 
    default: '', 
    trim: true 
  },
  amount: { 
    type: Number, 
    required: [true, 'Payment amount is required'], 
    min: [0.01, 'Payment amount must be at least 0.01'] 
  },
  currency: { 
    type: String, 
    required: true, 
    default: 'EUR', 
    enum: ['EUR'] 
  },
  paymentDate: { 
    type: Date, 
    default: Date.now, 
    required: true 
  },
  method: { 
    type: String, 
    required: true, 
    enum: ['Bank Transfer', 'Cash', 'Card', 'Cheque'],
    default: 'Bank Transfer'
  },
  paymentAccountId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ChartOfAccount', 
    required: true 
  },
  paymentAccountSnapshot: {
    code: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true }
  },
  reference: { 
    type: String, 
    default: '', 
    trim: true 
  },
  notes: { 
    type: String, 
    default: '', 
    trim: true 
  },
  status: { 
    type: String, 
    required: true, 
    enum: ['unallocated', 'partially_allocated', 'fully_allocated', 'reversed'],
    default: 'unallocated'
  },
  journalEntryId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'JournalEntry',
    default: null
  },
  reversalJournalEntryId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'JournalEntry', 
    default: null 
  },
  reversedAt: { 
    type: Date, 
    default: null 
  },
  reversedBy: { 
    type: String, 
    default: null 
  },
  reversalReason: { 
    type: String, 
    default: '' 
  },
  unappliedAmount: { 
    type: Number, 
    required: true, 
    min: [0, 'Payment unappliedAmount cannot be negative.'], 
    default: function() {
      return this.amount !== undefined ? this.amount : 0;
    } 
  },
  allocations: [paymentAllocationSchema],
  recordedBy: { 
    type: String, 
    default: 'System' 
  }
}, { timestamps: true });

// Multi-tenant and query performance indexes
paymentSchema.index({ company: 1, paymentNumber: 1 }, { unique: true });
paymentSchema.index({ company: 1, customerId: 1, status: 1 });
paymentSchema.index({ company: 1, paymentDate: -1 });
paymentSchema.index({ company: 1, 'allocations.invoiceId': 1 });
paymentSchema.index({ company: 1, 'allocations.allocationId': 1 });
paymentSchema.index({ company: 1, customerId: 1, unappliedAmount: 1 });

const IMMUTABLE_PAYMENT_FIELDS = [
  'company',
  'paymentNumber',
  'customerId',
  'amount',
  'currency',
  'paymentDate',
  'method',
  'paymentAccountId',
  'journalEntryId'
];

// Schema-level protection & Immutability Guards
paymentSchema.pre('validate', function() {
  if (!this.isNew) {
    for (const field of IMMUTABLE_PAYMENT_FIELDS) {
      if (this.isModified(field)) {
        throw new Error(`IMMUTABILITY VIOLATION: Financial field '${field}' on Payment cannot be modified after creation.`);
      }
    }
  }
});

paymentSchema.pre('save', function() {
  if (typeof this.amount === 'number') {
    this.amount = round2(this.amount);
  }
  if (typeof this.unappliedAmount === 'number') {
    this.unappliedAmount = round2(this.unappliedAmount);
  }

  if (this.unappliedAmount < 0) {
    throw new Error('Payment unappliedAmount cannot be negative.');
  }
  if (this.amount !== undefined && this.unappliedAmount > this.amount) {
    throw new Error('Payment unappliedAmount cannot exceed total payment amount.');
  }

  if (Array.isArray(this.allocations)) {
    for (const alloc of this.allocations) {
      if (typeof alloc.allocatedAmount === 'number') {
        alloc.allocatedAmount = round2(alloc.allocatedAmount);
      }
    }
  }

  if (!this.isNew) {
    for (const field of IMMUTABLE_PAYMENT_FIELDS) {
      if (this.isModified(field)) {
        throw new Error(`IMMUTABILITY VIOLATION: Financial field '${field}' on Payment cannot be modified after creation.`);
      }
    }
  } else {
    // New payment initialization: default unappliedAmount to total amount if zero/unset and no allocations
    if (this.unappliedAmount === undefined || this.unappliedAmount === null || (this.unappliedAmount === 0 && this.amount > 0 && (!this.allocations || this.allocations.length === 0))) {
      this.unappliedAmount = this.amount;
    }
  }
});

// Guard against mutating immutable fields via query update operations
paymentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function() {
  const update = this.getUpdate();
  if (!update) return;
  const fieldsToCheck = {
    ...update,
    ...(update.$set || {})
  };
  for (const field of IMMUTABLE_PAYMENT_FIELDS) {
    if (field in fieldsToCheck) {
      throw new Error(`IMMUTABILITY VIOLATION: Financial field '${field}' on Payment cannot be modified after creation.`);
    }
  }
});

// Forbid deletion of payment records at the database level (both query and document level)
paymentSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function() {
  throw new Error('IMMUTABILITY VIOLATION: Payment records cannot be deleted. Use payment reversal instead.');
});
paymentSchema.pre('deleteOne', { document: true, query: false }, function() {
  throw new Error('IMMUTABILITY VIOLATION: Payment records cannot be deleted. Use payment reversal instead.');
});

export default mongoose.model('Payment', paymentSchema);
