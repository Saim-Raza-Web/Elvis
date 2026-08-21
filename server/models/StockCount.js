import mongoose from 'mongoose';

const stockCountLineSchema = new mongoose.Schema({
  location: String,     // location code e.g. "MIA-PICK-A-01"
  sku: String,
  product: String,
  theoretical_qty: { type: Number, default: 0 }, // what system expects
  counted_qty: { type: Number, default: null },   // what operator scanned
  discrepancy: { type: Number, default: 0 },      // counted - theoretical
  status: { type: String, enum: ['pending', 'counted', 'discrepancy', 'adjusted', 'resolved'], default: 'pending' },
});

const stockCountSchema = new mongoose.Schema({
  countId: { type: String, required: true, unique: true },
  name: { type: String, default: 'Cycle Count Audit' },
  scope: { type: String, enum: ['full', 'zone', 'location', 'product'], default: 'zone' },
  scopeValue: String,   // e.g. "Aisle A" or "SKU-001"
  warehouse: String,
  status: { type: String, enum: ['open', 'in_progress', 'pending_approval', 'closed'], default: 'open' },
  lines: [stockCountLineSchema],
  startedBy: String,
  approvedBy: String,
  closedAt: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('StockCount', stockCountSchema);
