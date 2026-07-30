import mongoose from 'mongoose';

const scheduledReportSchema = new mongoose.Schema({
  report: { type: String, required: true },
  frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'weekly' },
  email: { type: String, required: true },
  format: { type: String, enum: ['pdf', 'csv'], default: 'pdf' },
  active: { type: Boolean, default: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('ScheduledReport', scheduledReportSchema);
