import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  role: { type: String, enum: ['admin', 'manager', 'warehouse_staff', 'client_3pl', 'management', 'office'], default: 'warehouse_staff' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  warehouses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' }]
}, { timestamps: true });

userSchema.index({ company: 1, role: 1 });
userSchema.index({ company: 1, clientId: 1 });
userSchema.index({ company: 1, warehouses: 1 });

export default mongoose.model('User', userSchema);