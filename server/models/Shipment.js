import mongoose from 'mongoose';

const shipmentSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true, unique: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  customer: String,
  carrier: String,
  tracking: String,
  origin: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  destination: String,
  status: String,
  weight: String,
  date: Date,
  eta: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Shipment', shipmentSchema);