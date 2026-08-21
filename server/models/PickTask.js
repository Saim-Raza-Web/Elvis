import mongoose from 'mongoose';

const pickTaskLineSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  productName: { type: String, required: true },
  orderedQty: { type: Number, required: true, min: 1 },
  pickedQty: { type: Number, default: 0 },
  shortfallQty: { type: Number, default: 0 },
  sourceLocation: { type: String, default: 'STAGING-A' },
  inventoryOwner: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'picked', 'partial', 'shortfall'], default: 'pending' }
}, { _id: true });

const pickTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true }, // PICK-2026-000001
  order: { type: String },
  orderId: { type: String, required: true },
  orderNumber: { type: String },
  orderType: { type: String, enum: ['B2B', 'B2C'], default: 'B2B' },
  owner: { type: String, required: true, default: 'Default Owner' },
  customer: { type: String, default: '' },
  warehouse: { type: String, default: 'MIA' },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  status: { type: String, enum: ['pending', 'in_progress', 'partially_picked', 'completed', 'cancelled'], default: 'pending' },
  assignee: { type: String, default: '' },
  linesCount: { type: Number, default: 0 },
  totalOrderedQty: { type: Number, default: 0 },
  totalPickedQty: { type: Number, default: 0 },
  totalShortfallQty: { type: Number, default: 0 },
  items: [pickTaskLineSchema],
  startedAt: Date,
  completedAt: Date,
  completedBy: String,
  deliveryNoteNumber: { type: String, default: '' },
  deliveryNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
  deliveryNoteUrl: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

pickTaskSchema.index({ company: 1, taskId: 1 }, { unique: true });
pickTaskSchema.index({ company: 1, orderId: 1 });
pickTaskSchema.index({ company: 1, owner: 1 });

export default mongoose.model('PickTask', pickTaskSchema);