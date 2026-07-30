import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  kind: { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
  title: { type: String, required: true },
  body: { type: String, required: true },
  read_at: { type: Date, default: null }
}, {
  timestamps: true
});

export default mongoose.models.Notification || mongoose.model('Notification', schema);
