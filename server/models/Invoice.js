import mongoose from 'mongoose';

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
    enum: ['draft', 'issued', 'sent', 'paid', 'cancelled'], 
    default: 'draft' 
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
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

invoiceSchema.index({ company: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ company: 1, customerId: 1 });
invoiceSchema.index({ company: 1, status: 1 });
invoiceSchema.index({ company: 1, issuedDate: -1 });

export default mongoose.model('Invoice', invoiceSchema);