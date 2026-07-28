import mongoose from 'mongoose';

const pickBatchSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true },
  orders: [{ type: String }],
  priority: { type: String, default: 'normal' },
  status: { type: String, default: 'pending' },
  assignee: { type: String },
  total_items: { type: Number, default: 0 },
  picked_items: { type: Number, default: 0 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('PickBatch', pickBatchSchema);
