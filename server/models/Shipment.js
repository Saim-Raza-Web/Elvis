import mongoose from 'mongoose';

const financialItemSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  qty: { type: Number, required: true, min: 0 },
  unitPriceSnapshot: { type: Number, required: true, min: 0 },
  revenueAmount: { type: Number, required: true, min: 0 }
}, { _id: false });

const shipmentSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true },
  packId: String,
  order: String,
  customer: String,
  carrier: String,
  tracking: String,
  origin: String,
  destination: String,
  status: String,
  weight: String,
  shipment_type: { type: String, enum: ['Parcel', 'Pallet'], default: 'Parcel' },
  pallets_count: { type: Number, default: 0 },
  date: Date,
  eta: Date,
  financial_items: [financialItemSchema],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

shipmentSchema.index({ company: 1, shipmentId: 1 }, { unique: true });
shipmentSchema.index({ company: 1, packId: 1 }, { unique: true, partialFilterExpression: { packId: { $exists: true, $type: 'string' } } });

export default mongoose.model('Shipment', shipmentSchema);