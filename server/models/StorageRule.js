import mongoose from 'mongoose';

const storageRuleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  conditionType: { type: String, enum: ['category', 'manufacturer', 'owner', 'brand'] },
  conditionValue: String, // e.g. "Electronics" or "Sony"
  targetZone: String,     // e.g. "Aisle A"
  targetLocationType: String, // e.g. "Cold Storage"
  priority: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('StorageRule', storageRuleSchema);
