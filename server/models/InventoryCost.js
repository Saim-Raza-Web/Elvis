import mongoose from 'mongoose';

const inventoryCostSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company is required for valuation isolation']
  },
  sku: {
    type: String,
    required: [true, 'SKU is required'],
    trim: true
  },
  owner: {
    type: String,
    required: [true, 'Owner is required for valuation segregation'],
    trim: true
  },
  ownerType: {
    type: String,
    enum: ['COMPANY'],
    required: true,
    default: 'COMPANY'
  },
  qty: {
    type: Number,
    default: 0,
    min: [0, 'InventoryCost quantity cannot be negative']
  },
  totalValue: {
    type: Number,
    default: 0,
    min: [0, 'InventoryCost totalValue cannot be negative']
  },
  wac: {
    type: Number,
    default: 0,
    min: [0, 'InventoryCost wac cannot be negative']
  }
}, { 
  timestamps: true,
  optimisticConcurrency: true // Mongoose 5.10+ native OCC protection using __v
});

// Enforce Company + SKU + Owner isolation
inventoryCostSchema.index({ company: 1, sku: 1, owner: 1 }, { unique: true });

export default mongoose.model('InventoryCost', inventoryCostSchema);
