import mongoose from 'mongoose';

const asnItemSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  expected_qty: { type: Number, required: true, min: 1 },
  received_qty: { type: Number, default: 0 },
  uom: { type: String, required: true, default: 'pcs' },
  lotNumber: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: Date },
  qcRequired: { type: Boolean, default: false },
  qc_status: { type: String, enum: ['pending', 'approved', 'partial', 'rejected'], default: 'pending' },
  notes: { type: String, default: '' }
}, { _id: true });

const asnSchema = new mongoose.Schema({
  asnId: { type: String, required: true }, // ASN-000001, ASN-000002...
  asnNumber: { type: String },              // Alias for asnId
  supplier: { type: String, required: true },
  poNumber: { type: String, required: true },
  po: { type: String },                     // Alias for poNumber
  origin: { type: String, default: '' },
  carrier: { type: String, default: '' },
  expectedDate: { type: Date, required: true },
  expected_date: { type: Date },            // Alias for expectedDate
  receivingDock: { type: String, required: true, default: 'Dock 1' },
  warehouse: { type: String, default: 'MIA' },
  notes: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'completed_with_discrepancies', 'cancelled'],
    default: 'pending'
  },
  sku_count: { type: Number, default: 0 },
  expected_units: { type: Number, default: 0 },
  items: [asnItemSchema],
  createdBy: { type: String, default: '' },
  deliveryNoteNumber: { type: String, default: '' }, // DN-2026-000001
  deliveryNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
  deliveryNoteUrl: { type: String, default: '' },
  isDeleted: { type: Boolean, default: false }, // Soft Delete flag for Enterprise Audit Trail
  deletedAt: { type: Date },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { 
  timestamps: true,
  optimisticConcurrency: true // Enforces Mongoose Optimistic Concurrency Control via __v
});

// Sync aliases before saving
asnSchema.pre('save', function () {
  if (this.asnId && !this.asnNumber) this.asnNumber = this.asnId;
  if (this.asnNumber && !this.asnId) this.asnId = this.asnNumber;
  if (this.poNumber && !this.po) this.po = this.poNumber;
  if (this.po && !this.poNumber) this.poNumber = this.po;
  if (this.expectedDate && !this.expected_date) this.expected_date = this.expectedDate;
  if (this.expected_date && !this.expectedDate) this.expectedDate = this.expected_date;

  if (Array.isArray(this.items)) {
    this.sku_count = this.items.length;
    this.expected_units = this.items.reduce((s, i) => s + (Number(i.expected_qty) || 0), 0);
  }
});

export default mongoose.model('ASN', asnSchema);