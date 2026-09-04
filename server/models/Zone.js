import mongoose from 'mongoose';

const zoneSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String },
  type: { type: String },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  locations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
  occupied: { type: Number },
  capacity: { type: Number },
  
  // Storage Rules v3 properties
  temperature_type: { type: String, enum: ['ambient', 'chilled_2_8', 'frozen_minus18', 'controlled_15_25'] },
  default_strategy: { type: String, enum: ['FIFO', 'FEFO', 'LIFO', 'FPFO', 'Nearest', 'Consolidate', 'Fill_first', 'Spread', 'Manual'] },
  allowed_categories: [{ type: String }],
  allowed_owners: [{ type: String }],
  hazmat_allowed: { type: Boolean, default: false },
  is_active: { type: Boolean, default: true },
  is_staging: { type: Boolean, default: false },
  
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('Zone', zoneSchema);