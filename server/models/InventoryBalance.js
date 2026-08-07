import mongoose from 'mongoose';

const inventoryBalanceSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  warehouse: { type: String, required: true, default: 'MIA' },
  zone: { type: String, default: 'Z-RECEIVING' },
  aisle: { type: String, default: 'A-1' },
  rack: { type: String, default: 'R-1' },
  bin: { type: String, default: 'BIN-01' },
  qtyAvailable: { type: Number, default: 0, min: [0, 'Available quantity cannot be negative'] },
  qtyQuarantine: { type: Number, default: 0, min: [0, 'Quarantine quantity cannot be negative'] },
  qtyAwaitingPutaway: { type: Number, default: 0, min: [0, 'Awaiting putaway quantity cannot be negative'] },
  qtyReserved: { type: Number, default: 0, min: [0, 'Reserved quantity cannot be negative'] },
  owner: { type: String, default: 'Default Owner' },
  lotNumber: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: Date },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Option A Virtual Property
inventoryBalanceSchema.virtual('totalQty').get(function () {
  return (this.qtyAvailable || 0) + (this.qtyQuarantine || 0) + (this.qtyAwaitingPutaway || 0) + (this.qtyReserved || 0);
});

// High-performance compound indexes for multi-warehouse 500,000+ record scale
inventoryBalanceSchema.index({ company: 1, warehouse: 1, sku: 1, owner: 1, lotNumber: 1, bin: 1 }, { unique: true });
inventoryBalanceSchema.index({ company: 1, warehouse: 1, sku: 1, owner: 1 });
inventoryBalanceSchema.index({ company: 1, warehouse: 1, bin: 1 });
inventoryBalanceSchema.index({ company: 1, sku: 1, owner: 1 });

export default mongoose.model('InventoryBalance', inventoryBalanceSchema);
