import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  documentNumber: { type: String, required: true }, // DN-2026-000001
  type: {
    type: String,
    enum: ['INBOUND_DELIVERY_NOTE', 'QC_REPORT', 'RTV_NOTE', 'PUTAWAY_MANIFEST'],
    default: 'INBOUND_DELIVERY_NOTE'
  },
  asnId: { type: String, required: true },
  asnNumber: { type: String, required: true },
  supplier: { type: String, required: true },
  poNumber: { type: String, required: true },
  warehouse: { type: String, default: 'MIA' },
  receivingDock: { type: String, default: 'Dock 1' },
  receivedAt: { type: Date, default: Date.now },
  totalExpected: { type: Number, required: true },
  totalReceived: { type: Number, required: true },
  hasDiscrepancies: { type: Boolean, default: false },
  discrepancyCount: { type: Number, default: 0 },
  items: [{
    sku: String,
    name: String,
    expected_qty: Number,
    received_qty: Number,
    uom: String,
    lotNumber: String,
    status: String
  }],
  pdfPath: { type: String, default: '' },
  pdfUrl: { type: String, default: '' },
  pdfDataUri: { type: String, default: '' },
  htmlContent: { type: String, default: '' },
  generatedBy: { type: String, default: 'system' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

documentSchema.index({ company: 1, documentNumber: 1 }, { unique: true });
documentSchema.index({ company: 1, asnNumber: 1 });
documentSchema.index({ company: 1, type: 1 });

export default mongoose.model('Document', documentSchema);
