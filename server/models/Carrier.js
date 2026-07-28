import mongoose from 'mongoose';

const carrierSchema = new mongoose.Schema({
  name: String,
  type: String,
  status: String,
  account: String,
  on_time: String,
  cost_avg: String,
  shipments_mtd: Number,
  regions: [String],
  label: Boolean,
  tracking: Boolean,
  features: [String],
  zones: [String], // Configurable list of zones for this carrier
  weight_brackets: [{ min: Number, max: Number, rate: Number }], // Pricing engine
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Carrier', carrierSchema);