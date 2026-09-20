import mongoose from 'mongoose';

const qcProfileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  fields: [{
    name: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['text', 'number', 'boolean', 'select'], default: 'text' },
    options: [{ type: String }],
    required: { type: Boolean, default: false }
  }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

qcProfileSchema.index({ company: 1, name: 1 }, { unique: true });

export default mongoose.model('QCProfile', qcProfileSchema);
