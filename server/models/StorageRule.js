import mongoose from 'mongoose';

const conditionSchema = new mongoose.Schema({
  field: { 
    type: String, 
    required: true,
    enum: ['product_category', 'owner', 'temperature', 'sku', 'pallet_weight', 'abc_class', 'has_lot_expiry', 'supplier', 'pallet_type', 'qc_status', 'hazmat_class', 'is_crossdock']
  },
  operator: { 
    type: String, 
    required: true,
    enum: ['is', 'is_not', 'in_list', 'not_in_list', 'greater_than', 'less_than', 'between', 'yes', 'no']
  },
  value: mongoose.Schema.Types.Mixed
}, { _id: false });

const storageRuleSchema = new mongoose.Schema({
  code: { type: String, required: true }, // e.g., CRIT-01, HIGH-01, DEFAULT
  name: { type: String, required: true },
  description: String,
  priority: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  ruleType: { type: String, enum: ['PUTAWAY', 'PICKING'], default: 'PUTAWAY' },
  isDefault: { type: Boolean, default: false }, // Protects the DEFAULT rule
  
  // IF Conditions (AND logic)
  conditions: [conditionSchema],

  // THEN Actions / Strategy
  action: { 
    type: String, 
    required: true,
    enum: [
      'send_to_zone', 
      'send_to_zone_reserve_only', 
      'send_to_pick_face', 
      'send_to_aisle', 
      'consolidate', 
      'fixed_location', 
      'manual_assignment', 
      'send_to_quarantine', 
      'cross_dock',
      'pick_from_zone',
      'pick_from_location',
      'pick_fefo',
      'pick_fifo',
      'pick_lifo'
    ] 
  },
  targetZone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  targetLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
  targetAisle: String,
  strategy: { type: String, enum: ['FIFO', 'FEFO', 'LIFO', 'FPFO', 'Nearest', 'Consolidate', 'Fill_first', 'Spread', 'Manual'] },
  
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// Prevent duplicate priority within same company, warehouse, and rule type.
storageRuleSchema.index({ company: 1, warehouse: 1, ruleType: 1, priority: 1 }, { unique: true });
storageRuleSchema.index({ company: 1, warehouse: 1, ruleType: 1, code: 1 }, { unique: true });

export default mongoose.model('StorageRule', storageRuleSchema);
