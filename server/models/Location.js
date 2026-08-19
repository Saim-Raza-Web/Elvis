import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String },
  warehouse: { type: String, required: true },
  zone: { type: String },
  aisle: String,
  shelf: String,
  bin: String,
  sku: { type: String },
  qty: { type: Number, default: 0 },
  currentUnits: { type: Number, default: 0, min: 0 },
  capacity: { type: Number, default: 1000 },
  maxUnits: { type: Number, default: 500 },
  maxWeight: { type: Number, default: 1000 },
  maxVolume: { type: Number, default: 10 },
  zoneType: { type: String, enum: ['AMBIENT', 'COLD_STORAGE', 'HAZMAT', 'PALLET_RACK'], default: 'AMBIENT' },
  status: { type: String, enum: ['ACTIVE', 'LOCKED', 'MAINTENANCE'], default: 'ACTIVE' },
  locationType: { type: String, enum: ['PALLET', 'SHELF', 'FLOOR', 'STAGING', 'OVERFLOW'], default: 'PALLET' },
  type: { type: String, enum: ['PALLET', 'SHELF', 'FLOOR', 'STAGING', 'OVERFLOW'], default: 'PALLET' },
  tempMin: { type: Number, default: 15 },
  tempMax: { type: Number, default: 25 },
  palletCapacity: { type: Number, default: 1 },
  boxCapacity: { type: Number, default: 50 },
  weightCapacity: { type: Number, default: 1000 },
  allowedOwners: [{ type: String }],
  active: { type: Boolean, default: true },
  allowed_manufacturers: [String],
  allowed_families: [String],
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