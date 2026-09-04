import mongoose from 'mongoose';

const poLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  supplierSku: { type: String, default: '' },
  description: { type: String, required: true },
  
  quantityOrdered: { type: Number, required: true, min: 1 },
  quantityReceived: { type: Number, default: 0, min: 0 },
  quantityBilled: { type: Number, default: 0, min: 0 },
  
  unitCost: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, default: 21, min: 0 }, // percentage
  
  lineSubtotal: { type: Number, required: true },
  taxAmount: { type: Number, required: true },
  lineTotal: { type: Number, required: true }
}, { _id: true });

const purchaseOrderSchema = new mongoose.Schema({
  poNumber: { type: String, required: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  
  source: { type: String, enum: ['manual', 'automatic_procurement'], default: 'manual' },
  sourceOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }, // For B2B linkage
  
  status: {
    type: String,
    enum: ['DRAFT', 'CONFIRMED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'BILLED', 'COMPLETED', 'CANCELLED'],
    default: 'DRAFT'
  },
  
  creationDate: { type: Date, default: Date.now },
  expectedDeliveryDate: { type: Date },
  
  currency: { type: String, default: 'EUR' },
  warehouse: { type: String, required: true }, // Delivery destination
  
  supplierReference: { type: String, default: '' },
  notes: { type: String, default: '' },

  // Email dispatch tracking
  sentAt: { type: Date, default: null },
  sentTo: { type: String, default: '' },

  lines: [poLineSchema],
  
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  taxTotal: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  
}, { timestamps: true });

purchaseOrderSchema.index({ company: 1, poNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ company: 1, supplierId: 1 });
purchaseOrderSchema.index({ company: 1, status: 1 });
purchaseOrderSchema.index({ company: 1, sourceOrderId: 1 }); // Fast lookup for traceability

// Auto-calculate totals before save
purchaseOrderSchema.pre('save', function () {
  if (this.lines && this.lines.length > 0) {
    this.subtotal = this.lines.reduce((sum, line) => sum + (line.lineSubtotal || 0), 0);
    this.taxTotal = this.lines.reduce((sum, line) => sum + (line.taxAmount || 0), 0);
    // Grand total is subtotal - discount + taxTotal
    this.grandTotal = parseFloat((this.subtotal - (this.discount || 0) + this.taxTotal).toFixed(2));
  }
});

export default mongoose.model('PurchaseOrder', purchaseOrderSchema);
