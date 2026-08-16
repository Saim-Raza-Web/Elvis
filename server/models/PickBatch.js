import mongoose from 'mongoose';

const groupedLineSchema = new mongoose.Schema({
  sourceLocation: { type: String, required: true },
  sku: { type: String, required: true },
  productName: { type: String, required: true },
  totalQtyToPick: { type: Number, required: true },
  pickedQty: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  tasks: [{ taskId: String, qty: Number }]
}, { _id: true });

const pickBatchSchema = new mongoose.Schema({
  batchId: { type: String, required: true },
  owner: { type: String, required: true, default: 'Default Owner' }, // STRICT OWNER ISOLATION!
  pickTaskIds: [{ type: String }],
  orders: [{ type: String }],
  priority: { type: String, default: 'normal' },
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'cancelled'], default: 'pending' },
  assignee: { type: String, default: '' },
  total_items: { type: Number, default: 0 },
  picked_items: { type: Number, default: 0 },
  groupedLines: [groupedLineSchema],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

pickBatchSchema.index({ company: 1, batchId: 1 }, { unique: true });
pickBatchSchema.index({ company: 1, owner: 1 });

export default mongoose.model('PickBatch', pickBatchSchema);
