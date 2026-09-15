import mongoose from 'mongoose';

const taskSuggestionRejectionSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  warehouse: { type: String, required: true, uppercase: true, trim: true, index: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },

  taskId: { type: String, required: true, index: true },
  taskLineId: { type: mongoose.Schema.Types.ObjectId, default: null }, // Null for Putaway, Line _id for Picking
  taskType: { type: String, enum: ['putaway', 'picking'], required: true },

  suggestedLocation: { type: String, required: true, uppercase: true, trim: true },
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
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rejectedAt: { type: Date, default: Date.now, index: true },

  // Exact rolling 24-hour escalation tracking flags
  escalated: { type: Boolean, default: false, index: true },
  escalatedAlertId: { type: String, default: null }
}, { timestamps: false });

// Warehouse facility-wide rolling 24h escalation index
taskSuggestionRejectionSchema.index({ company: 1, warehouse: 1, reasonCode: 1, escalated: 1, rejectedAt: -1 });

// Task sequential line rejection tracking index
taskSuggestionRejectionSchema.index({ company: 1, taskId: 1, taskLineId: 1, rejectedAt: 1 });

export default mongoose.model('TaskSuggestionRejection', taskSuggestionRejectionSchema);
