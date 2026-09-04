import mongoose from 'mongoose';

const putawayTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true },
  qcId: { type: String, default: '' },
  asnId: { type: String, default: '' },
  asnNumber: { type: String, default: '' },
  supplier: { type: String, default: '' },
  owner: { type: String, default: 'Default Owner' },
  ownerType: { type: String, enum: ['COMPANY', 'CUSTOMER', 'UNKNOWN'], required: true, default: 'UNKNOWN' },
  sku: { type: String, required: true },
  productName: { type: String, default: '' },
  warehouse: { type: String, required: true, default: 'MIA' },
  qty: { type: Number, required: true, min: 1 },
  lotNumber: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  fromLocation: { type: String, default: 'Z-RECEIVING' },
  toLocation: { type: String, default: 'RECEIVING-BUFFER' },
  destinationBin: { type: String, default: '' },
  priority: {
    type: String,
    enum: ['normal', 'high', 'urgent'],
    default: 'normal'
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  assignedTo: { type: String, default: '' },
  assignedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  completedBy: { type: String, default: '' },
  createdBy: { type: String, default: 'system' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// High-performance compound indexes for scale
putawayTaskSchema.index({ company: 1, taskId: 1 }, { unique: true });
putawayTaskSchema.index({ company: 1, warehouse: 1, status: 1, priority: 1 });
putawayTaskSchema.index({ company: 1, sku: 1 });
putawayTaskSchema.index({ company: 1, assignedTo: 1 });

export default mongoose.model('PutawayTask', putawayTaskSchema);
