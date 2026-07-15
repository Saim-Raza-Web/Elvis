import mongoose from 'mongoose';

const zoneSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String },
  type: { type: String },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  locations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
  occupied: { type: Number },
  capacity: { type: Number }
}, { timestamps: true });

export default mongoose.model('Zone', zoneSchema);