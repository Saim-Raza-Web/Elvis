import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  logId: { type: String, required: true },
  user: { type: String, required: true },
  role: String,
  action: { type: String, required: true },
  module: { type: String, required: true },
  detail: String,
  ip: String,
  timestamp: { type: Date, default: Date.now },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

activityLogSchema.index({ company: 1, logId: 1 }, { unique: true });
activityLogSchema.index({ company: 1, timestamp: -1 });
activityLogSchema.index({ company: 1, module: 1, action: 1 });
activityLogSchema.index({ company: 1, user: 1 });
activityLogSchema.index({ detail: 'text', user: 'text', action: 'text' });

export default mongoose.model('ActivityLog', activityLogSchema);