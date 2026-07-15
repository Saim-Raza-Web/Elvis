import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  plan: { type: String, enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  warehouses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' }]
}, { timestamps: true });

export default mongoose.model('Company', companySchema);