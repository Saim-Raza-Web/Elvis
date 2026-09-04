import mongoose from 'mongoose';

const inventoryTransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true },
  type: {
    type: String,
    enum: ['RECEIVING', 'QUARANTINE_HOLD', 'QC_RELEASE', 'QC_FAIL', 'RETURN_TO_VENDOR', 'PUTAWAY_CREATED', 'PUTAWAY_COMPLETE', 'ADJUSTMENT', 'TRANSFER', 'TRANSFER_OUT', 'TRANSFER_IN', 'PICK_EXECUTE', 'PICK_COMPLETE', 'RETURN'],
    required: true
  },
  sku: { type: String, required: true },
  owner: { type: String, default: 'Default Owner' },
  ownerType: { type: String, enum: ['COMPANY', 'CUSTOMER', 'UNKNOWN'] },
  warehouse: { type: String, required: true, default: 'MIA' },
  zone: { type: String, default: 'Z-RECEIVING' },
  aisle: { type: String, default: 'A-1' },
  rack: { type: String, default: 'R-1' },
  bin: { type: String, default: 'BIN-01' },
  qty: { type: Number, required: true },
  lotNumber: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: Date },
  asnNumber: { type: String, default: '' },
  referenceId: { type: String, default: '' },
  user: { type: String, default: 'system' },
  timestamp: { type: Date, default: Date.now },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// High-performance compound indexes for scale
inventoryTransactionSchema.index({ company: 1, transactionId: 1 }, { unique: true });
inventoryTransactionSchema.index({ company: 1, warehouse: 1, sku: 1, timestamp: -1 });
inventoryTransactionSchema.index({ company: 1, referenceId: 1 });
inventoryTransactionSchema.index({ company: 1, asnNumber: 1 });

export default mongoose.model('InventoryTransaction', inventoryTransactionSchema);
