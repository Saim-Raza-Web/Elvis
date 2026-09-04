import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  event_id: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, required: true },
  event_type: { 
    type: String, 
    required: true,
    enum: [
      'putaway_confirmed', 
      'pick_confirmed', 
      'override_requested', 
      'location_blocked', 
      'lot_recalled', 
      'replenishment_triggered', 
      'inventory_adjusted', 
      'task_timeout', 
      'task_reassigned', 
      'lot_blocked', 
      'cross_dock'
    ] 
  },
  
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_name: { type: String }, // Denormalized for historicity
  device_id: { type: String }, // Terminal/scanner ID

  location_code_from: { type: String },
  location_code_to: { type: String },
  
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  lot_number: { type: String },
  quantity: { type: Number },
  
  reference_id: { type: String }, // ID of related task, ASN, sales order or adjustment
  reason_code: { type: Number },
  reason_text: { type: String },
  
  previous_value: { type: mongoose.Schema.Types.Mixed }, // JSON state before event
  new_value: { type: mongoose.Schema.Types.Mixed }, // JSON state after event

  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: false }); // Disable automatic timestamps to enforce immutability

// Enforce immutability using a pre-hook on update/delete operations
auditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'remove'], function(next) {
  next(new Error('Audit logs are immutable and cannot be updated or deleted.'));
});

// Enforce immutability on document save if it's not new
auditLogSchema.pre('save', function(next) {
  if (!this.isNew) {
    return next(new Error('Audit logs are immutable and cannot be updated.'));
  }
  next();
});

auditLogSchema.index({ company: 1, timestamp: -1 });
auditLogSchema.index({ company: 1, event_type: 1 });
auditLogSchema.index({ company: 1, lot_number: 1 });
auditLogSchema.index({ company: 1, sku: 1 });
auditLogSchema.index({ company: 1, event_id: 1 }, { unique: true });

export default mongoose.model('AuditLog', auditLogSchema);
