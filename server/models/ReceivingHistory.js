import mongoose from 'mongoose';

const receivingHistorySchema = new mongoose.Schema({
  historyId: { type: String, required: true },
  asnId: { type: String, required: true },
  asnNumber: { type: String },
  sku: { type: String, required: true },
  productName: { type: String, default: '' },
  qtyReceived: { type: Number, required: true },
  beforeQty: { type: Number, default: 0 },
  afterQty: { type: Number, default: 0 },
  warehouse: { type: String, default: 'MIA' },
  receivingDock: { type: String, default: 'Dock 1' },
  operator: { type: String, default: 'system' },
  timestamp: { type: Date, default: Date.now },
  lotNumber: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: Date },
  qcRequired: { type: Boolean, default: false },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('ReceivingHistory', receivingHistorySchema);
