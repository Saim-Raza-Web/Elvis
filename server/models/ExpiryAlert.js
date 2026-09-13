import mongoose from 'mongoose';

const locationItemSchema = new mongoose.Schema({
  bin: { type: String, required: true },
  qtyAvailable: { type: Number, default: 0 },
  qtyReserved: { type: Number, default: 0 },
  qtyAwaitingPutaway: { type: Number, default: 0 },
  qtyQuarantine: { type: Number, default: 0 },
  totalQty: { type: Number, default: 0 }
}, { _id: false });

const expiryAlertSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  warehouse: { type: String, required: true },
  sku: { type: String, required: true },
  lotNumber: { type: String, default: '' },
  expiryDate: { type: Date, required: true },
  category: { type: String, default: 'GEN' },

  severity: { 
    type: String, 
    enum: ['WARNING', 'HIGH', 'CRITICAL', 'EXPIRED'], 
    required: true 
  },
  daysRemaining: { type: Number, required: true },
  thresholdBreached: { 
    type: String, 
    enum: ['T_ALERT', 'T_BLOCK', 'T_WITHDRAWAL', 'EXPIRED'], 
    required: true 
  },
  actionRequired: { type: String, default: 'NONE' },

  // Physical inventory quantity breakdown (snapshot)
  qtyAvailable: { type: Number, default: 0 },
  qtyReserved: { type: Number, default: 0 },
  qtyAwaitingPutaway: { type: Number, default: 0 },
  qtyQuarantine: { type: Number, default: 0 },
  totalQty: { type: Number, default: 0 },

  // Aggregated bin locations holding this lot
  locations: [locationItemSchema],

  owner: { type: String, default: 'Default Owner' },
  ownerType: { 
    type: String, 
    enum: ['COMPANY', 'CUSTOMER', 'UNKNOWN'], 
    required: true, 
    default: 'COMPANY' 
  },

  isRecalled: { type: Boolean, default: false },

  // Alert State Machine: OPEN -> ACKNOWLEDGED -> RESOLVED / DISMISSED
  status: { 
    type: String, 
    enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'], 
    default: 'OPEN',
    required: true 
  },

  acknowledgedAt: { type: Date },
  acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acknowledgedByName: { type: String },
  acknowledgementNote: { type: String },

  resolvedAt: { type: Date },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedByName: { type: String },
  resolutionReason: { type: String },

  dismissedAt: { type: Date },
  dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  dismissedByName: { type: String },
  dismissalReason: { type: String },

  lastEvaluatedAt: { type: Date, default: Date.now },
  runId: { type: String },

  // Notification deduplication state
  lastNotifiedSeverity: {
    type: String,
    enum: ['NONE', 'WARNING', 'HIGH', 'CRITICAL', 'EXPIRED'],
    default: 'NONE'
  }
}, {
  timestamps: true
});

// Deterministic unique identity: company + warehouse + sku + lotNumber + owner
expiryAlertSchema.index({ company: 1, warehouse: 1, sku: 1, lotNumber: 1, owner: 1 }, { unique: true });
expiryAlertSchema.index({ company: 1, status: 1, severity: 1, daysRemaining: 1 });
expiryAlertSchema.index({ company: 1, warehouse: 1, status: 1 });
expiryAlertSchema.index({ company: 1, owner: 1, status: 1 });
expiryAlertSchema.index({ company: 1, daysRemaining: 1 });
expiryAlertSchema.index({ company: 1, sku: 1 });

export default mongoose.models.ExpiryAlert || mongoose.model('ExpiryAlert', expiryAlertSchema);
