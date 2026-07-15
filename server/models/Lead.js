import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema({
  leadId: { type: String, required: true, unique: true },
  name: String,
  contact: String,
  email: String,
  value: Number,
  stage: String,
  probability: Number,
  assignee: String,
  last_contact: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Lead', leadSchema);