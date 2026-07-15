import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  logId: { type: String, required: true, unique: true },
  user: String,
  role: String,
  action: String,
  module: String,
  detail: String,
  ip: String,
  timestamp: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('ActivityLog', activityLogSchema);