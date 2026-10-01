import mongoose from 'mongoose';

const warehouseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  location: { type: String },
  country: { type: String },
  capacity: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  status: { type: String },
  manager: { type: String },
  temp: { type: String },
  blindReceiving: { type: Boolean, default: false },
  zones: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Zone' }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Warehouse', warehouseSchema);