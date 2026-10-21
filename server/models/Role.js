import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  roleId: { type: String, required: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  color: { type: String, default: 'text-primary bg-primary/10' },
  isSystem: { type: Boolean, default: false },
  permissions: {
    type: Map,
    of: Boolean,
    default: {}
  }
}, { timestamps: true });

// Compound unique index for role within a company
roleSchema.index({ company: 1, roleId: 1 }, { unique: true });

export default mongoose.model('Role', roleSchema);
