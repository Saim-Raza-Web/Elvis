import mongoose from 'mongoose';

const quarantineInventorySchema = new mongoose.Schema({
  quarantineId: { type: String, required: true },
  inspectionId: { type: String, default: '' },
  asnId: { type: String, required: true },
  asnNumber: { type: String },
  sku: { type: String, required: true },
  productName: { type: String, default: '' },
  warehouse: { type: String, default: 'MIA' },
  bin: { type: String, default: 'BIN-01' },
  qty: { type: Number, required: true },
  lotNumber: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: Date },
  status: {
    type: String,
    enum: ['received', 'quarantine', 'pending_qc', 'under_inspection', 'qc_passed', 'awaiting_putaway', 'qc_failed', 'returned_to_vendor', 'released'],
    default: 'pending_qc'
  },
  failReason: { type: String, default: '' },
  rtvAuthNumber: { type: String, default: '' },
  rtvCarrier: { type: String, default: '' },
  user: { type: String, default: 'system' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('QuarantineInventory', quarantineInventorySchema);
