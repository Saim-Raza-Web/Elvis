import mongoose from 'mongoose';

const qcInspectionSchema = new mongoose.Schema({
  inspectionId: { type: String, required: true, unique: true },
  quarantineId: { type: String, required: true },
  asnId: { type: String, default: '' },
  asnNumber: { type: String, default: '' },
  sku: { type: String, required: true },
  productName: { type: String, default: '' },
  warehouse: { type: String, default: 'MIA' },
  qty: { type: Number, required: true, min: 1 },
  lotNumber: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: Date },
  inspector: { type: String, default: 'system' },
  inspectionDate: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['pending_qc', 'under_inspection', 'qc_passed', 'qc_failed', 'returned_to_vendor'],
    default: 'under_inspection'
  },
  packagingCondition: { type: String, default: 'Good' },
  productCondition: { type: String, default: 'Pass' },
  temperature: { type: String, default: 'N/A' },
  humidity: { type: String, default: 'N/A' },
  damageLevel: { type: String, default: 'None' },
  missingLabels: { type: Boolean, default: false },
  visualInspection: { type: String, default: 'Pass' },
  functionalTest: { type: String, default: 'Pass' },
  notes: { type: String, default: '' },
  arrivalTemp: { type: Number },
  minTemp: { type: Number },
  maxTemp: { type: Number },
  humidityPct: { type: Number },
  dataLogger: { type: String, default: '' },
  tempRangeMin: { type: Number, default: 2 },
  tempRangeMax: { type: Number, default: 8 },
  blocked: { type: Boolean, default: false },
  unblockedBy: { type: String, default: '' },
  approvedQty: { type: Number },
  rejectedQty: { type: Number, default: 0 },
  rejectionDestination: { type: String, enum: ['RTV', 'Quarantine', 'Destruction', ''], default: '' },
  attachments: [{
    url: String,
    filename: String,
    fileType: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now }
  }],
  failReason: { type: String, default: '' },
  rtvAuthNumber: { type: String, default: '' },
  rtvCarrier: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('QCInspection', qcInspectionSchema);
