import mongoose from 'mongoose';

const productCategorySchema = new mongoose.Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  qc_behaviour: { type: String, default: 'Standard' },
  recommended_zone: { type: String, default: 'Any available zone' },
  description: { type: String, default: '' },
  active: { type: Boolean, default: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

productCategorySchema.index({ company: 1, code: 1 }, { unique: true });

export default mongoose.model('ProductCategory', productCategorySchema);
