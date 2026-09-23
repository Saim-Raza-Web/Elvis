import mongoose from 'mongoose';

const returnSchema = new mongoose.Schema({
  returnId: { type: String, required: true, unique: true },
  order: String,
  customer: String,
  owner: { type: String, default: 'Default Owner' },
  ownerType: { type: String, enum: ['COMPANY', 'CUSTOMER', 'UNKNOWN'], default: 'UNKNOWN' },
  reason: String,
  items: Number,
  amount: Number,
  status: String,
  date: Date,
  warehouse: String,
  items_details: [{
    sku: String,
    product: String,
    qty: Number,
    lotNumber: { type: String, default: 'DEFAULT-LOT' },
    qc_status: { type: String, default: 'pending' },
    decision: {
      type: String,
      enum: ['PENDING_DECISION', 'RESTOCK_CLIENT', 'RESTOCK_COMPANY', 'INCIDENT', 'WRITEOFF'],
      default: 'PENDING_DECISION'
    },
    decision_reason: { type: String, default: '' },
    decision_by: { type: String, default: '' },
    decision_date: { type: Date },
    incidentId: { type: String, default: '' },
    notes: String
  }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Return', returnSchema);