import mongoose from 'mongoose';

const pickTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true },
  order: String,
  priority: String,
  status: String,
  assignee: String,
  items: Number,
  picked: Number,
  zone: String,
  started: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('PickTask', pickTaskSchema);