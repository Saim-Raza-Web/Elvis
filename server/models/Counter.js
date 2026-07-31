import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. 'delivery_note'
  seq: { type: Number, default: 0 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
});

counterSchema.index({ _id: 1, company: 1 }, { unique: true });

export default mongoose.model('Counter', counterSchema);
