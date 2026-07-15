import mongoose from 'mongoose';

const ecommerceChannelSchema = new mongoose.Schema({
  name: String,
  platform: String,
  url: String,
  apiKey: String,
  status: String,
  orders_today: Number,
  synced_at: Date,
  products: Number,
  pending_sync: Number,
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('EcommerceChannel', ecommerceChannelSchema);