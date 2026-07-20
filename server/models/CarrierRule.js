import mongoose from 'mongoose';

const carrierRuleSchema = new mongoose.Schema({
  name: String,
  condition: String,
  carrier: String,
  active: Boolean,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('CarrierRule', carrierRuleSchema);