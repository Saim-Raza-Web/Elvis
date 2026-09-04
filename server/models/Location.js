import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  zone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  aisle: String,
  shelf: String,
  bin: String,
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  qty: { type: Number, default: 0 },
  currentUnits: { type: Number, default: 0, min: 0 },
  capacity: { type: Number, default: 1000 },
  maxUnits: { type: Number, default: 500 },
  maxWeight: { type: Number, default: 1000 },
  maxVolume: { type: Number, default: 10 },
  zoneType: { type: String, enum: ['AMBIENT', 'COLD_STORAGE', 'HAZMAT', 'PALLET_RACK'], default: 'AMBIENT' },
  status: { type: String, enum: ['AVAILABLE', 'BLOCKED', 'MAINTENANCE', 'RESERVED', 'CYCLE_COUNT', 'ACTIVE', 'LOCKED'], default: 'AVAILABLE' },
  locationType: { type: String, enum: ['PALLET', 'SHELF', 'FLOOR', 'STAGING', 'OVERFLOW', 'pallet_floor', 'shelf_box', 'bin', 'pick_face', 'dispatch', 'returns', 'quarantine', 'blocked'], default: 'pallet_floor' },
  type: { type: String, enum: ['PALLET', 'SHELF', 'FLOOR', 'STAGING', 'OVERFLOW', 'pallet_floor', 'shelf_box', 'bin', 'pick_face', 'dispatch', 'returns', 'quarantine', 'blocked'], default: 'pallet_floor' },
  tempMin: { type: Number, default: 15 },
  tempMax: { type: Number, default: 25 },
  palletCapacity: { type: Number, default: 1 },
  boxCapacity: { type: Number, default: 50 },
  weightCapacity: { type: Number, default: 1000 },
  allowedOwners: [{ type: String }],
  active: { type: Boolean, default: true },
  allowed_manufacturers: [String],
  allowed_families: [String],
  
  // Storage Rules v3 properties
  is_pick_face: { type: Boolean, default: false },
  max_pallets: { type: Number, default: 1 },
  max_weight_kg: { type: Number },
  level_weight_limit: { type: Number },
  temperature_type: { type: String, enum: ['ambient', 'chilled_2_8', 'frozen_minus18', 'controlled_15_25'] },
  allowed_categories: [{ type: String }],
  single_owner_enforced: { type: Boolean, default: true },
  single_lot_enforced: { type: Boolean, default: true },
  min_stock: { type: Number },
  max_stock: { type: Number },
  notes: { type: String },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

locationSchema.pre('save', function () {
  if (this.locationType && !this.type) this.type = this.locationType;
  if (this.type && !this.locationType) this.locationType = this.type;
});

// Scoped unique index allowing different warehouses (MIA, NYC, LAX, DAL) to have identical bin codes
locationSchema.index({ company: 1, warehouse: 1, code: 1 }, { unique: true });
locationSchema.index({ company: 1, warehouse: 1, zone: 1 });
locationSchema.index({ company: 1, status: 1 });

export default mongoose.model('Location', locationSchema);