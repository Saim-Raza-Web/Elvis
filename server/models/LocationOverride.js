import mongoose from 'mongoose';

const suggestionHistoryItemSchema = new mongoose.Schema({
  suggestedLocation: { type: String, required: true, uppercase: true, trim: true },
  reasonCode: {
    type: String,
    enum: ['SPACE_CONSTRAINT', 'CUSTOMER_REQUEST', 'DAMAGE', 'WEIGHT_LIMIT', 'TEMPERATURE_MISMATCH', 'OTHER'],
    required: true
  },
  reasonText: { type: String, default: '' },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rejectedAt: { type: Date, default: Date.now }
}, { _id: true });

const locationOverrideSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  warehouse: { type: String, required: true, uppercase: true, trim: true, index: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },

  // Task & Line Reference
  taskId: { type: String, required: true, index: true },
  taskLineId: { type: mongoose.Schema.Types.ObjectId, default: null }, // Null for Putaway, item._id for Picking
  taskType: { type: String, enum: ['putaway', 'picking'], required: true, index: true },
  sourceModel: { type: String, enum: ['PutawayTask', 'PickTask'], required: true },
  taskRef: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'sourceModel' },

  proposedLocation: { type: String, required: true, uppercase: true, trim: true },
  overrideLocation: { type: String, default: null, uppercase: true, trim: true },

  reasonCode: {
    type: String,
    enum: ['SPACE_CONSTRAINT', 'CUSTOMER_REQUEST', 'DAMAGE', 'WEIGHT_LIMIT', 'TEMPERATURE_MISMATCH', 'OTHER'],
    required: true,
    index: true
  },
  reasonText: {
    type: String,
    default: '',
    validate: {
      validator: function(v) {
        if (this.reasonCode === 'OTHER') {
          return typeof v === 'string' && v.trim().length >= 10;
        }
        return true;
      },
      message: "reasonText is mandatory and must be at least 10 characters when reasonCode is 'OTHER'."
    }
  },

  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW'],
    default: 'PENDING',
    index: true
  },

  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestedByEmail: { type: String, default: '' },
  authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  authorizedByEmail: { type: String, default: '' },
  authorizedAt: { type: Date, default: null },

  rejectionCount: { type: Number, default: 0, min: 0 },
  rejectionHistory: [suggestionHistoryItemSchema],

  escalation: {
    isEscalated: { type: Boolean, default: false },
    escalatedAt: { type: Date, default: null },
    alertId: { type: String, default: null }
  },

  notes: { type: String, default: '' },
  idempotencyKey: { type: String, sparse: true, index: true }
}, {
  timestamps: true,
  optimisticConcurrency: true
});

// Single active override per task line (Putaway: taskLineId = null; Picking: taskLineId = item._id)
locationOverrideSchema.index(
  { company: 1, taskId: 1, taskLineId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'NEEDS_REVIEW'] } } }
);

locationOverrideSchema.index({ company: 1, warehouse: 1, status: 1, createdAt: -1 });

export default mongoose.model('LocationOverride', locationOverrideSchema);
