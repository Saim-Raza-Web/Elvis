import mongoose from 'mongoose';

const warehouseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  location: { type: String },
  country: { type: String },
  capacity: { type: Number },
  used: { type: Number },
  status: { type: String },
  manager: { type: String },
  temp: { type: String },
  zones: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Zone' }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Warehouse', warehouseSchema);