import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  name: String,
  category: { type: String, default: 'GEN' },
  manufacturer: String,
  brand: String,
  warehouse: { type: String },
  price: Number,
  qty_available: Number,
  qty_reserved: Number,
  qty_blocked: Number,
  qty_ecommerce: Number,
  qty_customer_owned: Number,
  status: String,
  owner: String,
  reorder_point: Number,
  min_stock: Number,
  max_stock: Number,
  safety_stock: Number,
  unitBarcode: { type: String, trim: true, default: '' },
  caseBarcode: { type: String, trim: true, default: '' },
  caseMultiplier: { type: Number, default: 1, min: 1 },
  temperature_range: { type: String, default: 'Ambient (15°C - 25°C)' },
  qc_profile: { type: String, default: 'Standard QC' },
  
  // Storage Rules v3 UOM Hierarchy
  base_uom: { type: String, enum: ['PLT', 'CSE', 'EA'], default: 'EA' },
  units_per_case: { type: Number },
  cases_per_pallet: { type: Number },
  allow_split_pallet: { type: Boolean, default: true },
  allow_split_case: { type: Boolean, default: true },
  min_pick_unit: { type: String, enum: ['PLT', 'CSE', 'EA'], default: 'EA' },
  pallet_weight_kg: { type: Number },
  pallet_volume_m3: { type: Number },

  // Storage Rules v3 ABC Classification
  sku_abc_class: { type: String, enum: ['A', 'B', 'C'] },
  abc_calc_date: { type: Date },
  abc_pick_count_period: { type: Number },
  abc_class_override: { type: String, enum: ['A', 'B', 'C'] },
  abc_override_reason: { type: String },
  abc_override_set_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Storage Rules v3 Lot & Expiry
  fefo: { type: Boolean, default: false },
  lot_tracking: { type: Boolean, default: false },
  hazmat_class: { type: String, enum: ['FOOD', 'CHEMICAL', 'PHARMA', 'HAZMAT', 'COSMETIC', 'ELECTRONIC', 'GENERAL'], default: 'GENERAL' },

  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

productSchema.index({ company: 1, sku: 1 }, { unique: true });
productSchema.index({ company: 1, unitBarcode: 1 }, { sparse: true });
productSchema.index({ company: 1, caseBarcode: 1 }, { sparse: true });
productSchema.index({ company: 1, category: 1 });

export default mongoose.model('Product', productSchema);