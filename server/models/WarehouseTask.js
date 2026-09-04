import mongoose from 'mongoose';

const warehouseTaskSchema = new mongoose.Schema({
  task_type: { 
    type: String, 
    required: true,
    enum: ['putaway', 'picking', 'replenishment', 'transfer', 'cycle_count', 'withdrawal', 'cross_dock']
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'timed_out'],
    default: 'pending'
  },
  priority: { type: Number, enum: [1, 2, 3, 4], default: 3 }, // 1 (critical), 2 (high), 3 (medium), 4 (low)
  timeout_minutes: { type: Number, default: 15 },
  timeout_at: { type: Date },
  
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignment_mode: { type: String, enum: ['auto', 'manual', 'self', 'zone_broadcast'], default: 'auto' },

  // Task details
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  lot_number: { type: String },
  qty: { type: Number },
  
  source_location: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
  destination_location: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
  zone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  
  reference_id: { type: String }, // e.g., ASN ID, Order ID, Recall ID

  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

warehouseTaskSchema.index({ company: 1, status: 1, priority: 1 });
warehouseTaskSchema.index({ company: 1, assigned_to: 1, status: 1 });
warehouseTaskSchema.index({ company: 1, task_type: 1 });

export default mongoose.model('WarehouseTask', warehouseTaskSchema);
