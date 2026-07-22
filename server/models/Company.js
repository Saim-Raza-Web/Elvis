import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  plan: { type: String, enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  warehouses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' }],
  timezone: { type: String, default: 'America/New_York' },
  currency: { type: String, default: 'EUR' },
  dateFormat: { type: String, default: 'YYYY-MM-DD' },
  emailNotifs: { type: Boolean, default: true },
  orderNotifs: { type: Boolean, default: true },
  lowStockNotifs: { type: Boolean, default: true },
  shipmentNotifs: { type: Boolean, default: false },
  apiKeys: [{
    name: String,
    key: String,
    createdAt: { type: Date, default: Date.now },
    lastUsed: { type: Date }
  }]
}, { timestamps: true });

export default mongoose.model('Company', companySchema);