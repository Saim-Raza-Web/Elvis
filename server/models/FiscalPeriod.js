import mongoose from 'mongoose';

const fiscalPeriodSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  fiscalYear: { type: Number, required: true },
  period: { type: Number, required: true },
  name: { type: String, required: true, trim: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
  closedAt: { type: Date },
  closedBy: { type: String },
  createdBy: { type: String, default: 'System' }
}, { timestamps: true });

fiscalPeriodSchema.index({ company: 1, fiscalYear: 1, period: 1 }, { unique: true });
fiscalPeriodSchema.index({ company: 1, startDate: 1, endDate: 1 });
fiscalPeriodSchema.index({ company: 1, status: 1 });

export default mongoose.model('FiscalPeriod', fiscalPeriodSchema);
