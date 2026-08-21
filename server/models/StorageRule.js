import mongoose from 'mongoose';

const storageRuleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  priority: { type: Number, default: 1, required: true },
  isActive: { type: Boolean, default: true },
  ruleType: { type: String, enum: ['PUTAWAY', 'PICKING'], default: 'PUTAWAY' },
  
  // IF Conditions
  conditionType: { type: String, enum: ['category', 'manufacturer', 'owner', 'brand', 'sku', 'temperature', 'hazmat'] },
  conditionValue: String,
  tempMin: Number,
  tempMax: Number,
  isHazmat: Boolean,

  // THEN Actions / Strategy
  targetZone: String,
  targetLocationType: String,
  pickingStrategy: { type: String, enum: ['FEFO', 'FIFO', 'LIFO', 'FPFO'], default: 'FEFO' },
  minPickUnit: { type: String, enum: ['PLT', 'CSE', 'EA'], default: 'EA' },

  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('StorageRule', storageRuleSchema);
