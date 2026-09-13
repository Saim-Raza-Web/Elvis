import mongoose from 'mongoose';

/**
 * WorkerLease Model (Stage 8)
 * 
 * Provides distributed, database-backed atomic leasing for scheduled/background workers.
 * Eliminates in-memory locks, ensuring strict safety across serverless instances and multi-node deployments.
 */
const workerLeaseSchema = new mongoose.Schema({
  jobKey: { type: String, required: true, unique: true },
  leaseOwner: { type: String, required: true },
  leaseUntil: { type: Date, required: true },
  status: { 
    type: String, 
    enum: ['ACQUIRED', 'RELEASED'], 
    default: 'ACQUIRED',
    required: true 
  },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  lastHeartbeat: { type: Date, default: Date.now },
  lastRunAt: { type: Date },
  lastRunStatus: { type: String },
  lastRunDurationMs: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, {
  timestamps: true
});

workerLeaseSchema.index({ status: 1, leaseUntil: 1 });
workerLeaseSchema.index({ company: 1, jobKey: 1 });

export default mongoose.models.WorkerLease || mongoose.model('WorkerLease', workerLeaseSchema);
