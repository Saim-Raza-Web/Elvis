import mongoose from 'mongoose';

const returnSchema = new mongoose.Schema({
  returnId: { type: String, required: true, unique: true },
  order: String,
  customer: String,
  reason: String,
  items: Number,
  amount: Number,
  status: String,
  date: Date,
  warehouse: String,
  items_details: [{
    sku: String,
    qty: Number,
    qc_status: { type: String, enum: ['pending', 'restock', 'damage', 'disposed'], default: 'pending' },
    notes: String
  }],
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
}, { timestamps: true });

export default mongoose.model('Return', returnSchema);