import mongoose from 'mongoose';

const digitalSignatureSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true },
  shipmentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
  signerName: { type: String, required: true },
  signerEmail: { type: String, required: true },
  signerRole: { type: String, required: true },
  signatureData: { type: String, required: true }, // Base64 encoded signature image
  signedAt: { type: Date, required: true, default: Date.now },
  ipAddress: { type: String },
  discrepancyNote: { type: String },
  warehouse: { type: String },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' }, // Signed document reference
  emailStatus: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  emailError: { type: String },
  emailSentAt: { type: Date }
}, { timestamps: true });

digitalSignatureSchema.index({ company: 1, shipmentId: 1 }, { unique: true });
digitalSignatureSchema.index({ company: 1, shipmentRef: 1 });
digitalSignatureSchema.index({ company: 1, signedAt: -1 });

export default mongoose.model('DigitalSignature', digitalSignatureSchema);
