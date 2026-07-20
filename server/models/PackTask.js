import mongoose from 'mongoose';

const packTaskSchema = new mongoose.Schema({
  packId: { type: String, required: true, unique: true },
  order: String,
  customer: String,
  items: Number,
  picked: Number,
  station: String,
  priority: String,
  status: String,
  boxType: String,
  weight: String,
  material: String,
  labelPrinted: Boolean,
  weighed: Boolean,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('PackTask', packTaskSchema);