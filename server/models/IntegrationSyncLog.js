import mongoose from 'mongoose';

const integrationSyncLogSchema = new mongoose.Schema({
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true, 
    index: true 
  },
  connectedStore: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ConnectedStore', 
    required: true, 
    index: true 
  },
  provider: { 
    type: String, 
    required: true 
  },
  syncType: { 
    type: String, 
    enum: ['product', 'order', 'inventory', 'full'], 
    required: true 
  },
  trigger: { 
    type: String, 
    enum: ['manual', 'scheduled', 'webhook'], 
    default: 'manual' 
  },
  status: { 
    type: String, 
    enum: ['started', 'completed', 'failed'], 
    default: 'started',
    index: true 
  },
  startedAt: { 
    type: Date, 
    default: Date.now 
  },
  completedAt: { 
    type: Date 
  },
  durationMs: { 
    type: Number, 
    default: 0 
  },
  
  // ── Metric Counters ─────────────────────────────────────
  recordsProcessed: { type: Number, default: 0 },
  recordsCreated: { type: Number, default: 0 },
  recordsUpdated: { type: Number, default: 0 },
  recordsFailed: { type: Number, default: 0 },

  // ── Detailed Error Breakdowns ───────────────────────────
  errorDetails: [{
    item: { type: String },
    reason: { type: String }
  }],
  summary: { 
    type: String, 
    default: '' 
  }
}, { 
  timestamps: true 
});

integrationSyncLogSchema.index({ company: 1, connectedStore: 1, createdAt: -1 });

export default mongoose.model('IntegrationSyncLog', integrationSyncLogSchema);
