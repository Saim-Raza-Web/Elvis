import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  name: String,
  contact: String,
  email: String,
  phone: String,
  country: String,
  orders: Number,
  total_spend: Number,
  status: String,
  tier: String,
  last_activity: Date,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Customer', customerSchema);