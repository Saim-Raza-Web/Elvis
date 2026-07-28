import mongoose from 'mongoose';

const shipmentSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true, unique: true },
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
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Shipment', shipmentSchema);