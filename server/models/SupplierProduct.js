import mongoose from 'mongoose';

const supplierProductSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  
  supplierSku: { type: String, required: true, trim: true },
  supplierProductName: { type: String, default: '', trim: true },
  
  purchaseCost: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'EUR' },
  
  moq: { type: Number, default: 1, min: 1 },
  leadTimeDays: { type: Number, default: 7, min: 0 },
  
  isPreferred: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  
  taxRate: { type: Number, default: 21 }, // Default Spanish VAT
  
  supplierProductUrl: { type: String, default: '' },
  
  lastPurchaseCost: { type: Number, default: null },
  lastPurchaseDate: { type: Date, default: null }
}, { timestamps: true });

// Prevent duplicate supplier-product relationships for the same company
supplierProductSchema.index({ company: 1, supplierId: 1, productId: 1 }, { unique: true });

// Fast lookups for procurement engine
supplierProductSchema.index({ company: 1, productId: 1, isPreferred: -1, purchaseCost: 1 });

export default mongoose.model('SupplierProduct', supplierProductSchema);
