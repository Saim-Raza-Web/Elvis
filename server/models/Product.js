import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  name: String,
  category: String,
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
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

productSchema.index({ company: 1, sku: 1 }, { unique: true });
productSchema.index({ company: 1, unitBarcode: 1 }, { sparse: true });
productSchema.index({ company: 1, caseBarcode: 1 }, { sparse: true });

export default mongoose.model('Product', productSchema);