import mongoose from 'mongoose';

const ediInterchangeSchema = new mongoose.Schema({
  interchangeControlRef: { type: String, required: true },
  direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], required: true, default: 'INBOUND' },
  standard: { type: String, enum: ['EDIFACT', 'X12'], required: true, default: 'EDIFACT' },
  documentType: { type: String, enum: ['ORDERS', 'DESADV', 'INVOIC', 'OTHER'], required: true, default: 'ORDERS' },
  senderId: { type: String, required: true },
  recipientId: { type: String, required: true },
  rawPayload: { type: String, required: true },
  parsedPayload: { type: mongoose.Schema.Types.Mixed },
  status: {
    type: String,
    enum: ['RECEIVED', 'PARSED', 'PROCESSED', 'QUARANTINED', 'FAILED', 'ERROR'],
    required: true,
    default: 'RECEIVED'
  },
  errors: [{ type: String }],
  errorMessage: { type: String },
  errorStack: { type: String },
  targetOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  targetShipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
  orderId: { type: String },
  retryCount: { type: Number, default: 0 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true, suppressReservedKeysWarning: true });

ediInterchangeSchema.index({ company: 1, interchangeControlRef: 1, senderId: 1 }, { unique: true });
ediInterchangeSchema.index({ company: 1, status: 1, createdAt: -1 });

export default mongoose.model('EdiInterchange', ediInterchangeSchema);
