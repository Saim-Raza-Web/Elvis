import mongoose from 'mongoose';

const inventoryValuationLedgerSchema = new mongoose.Schema({
  accountingUrn: {
    type: String,
    required: [true, 'Accounting URN is required for exactly-once idempotency'],
    trim: true,
    unique: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  sku: {
    type: String,
    required: true,
    trim: true
  },
  owner: {
    type: String,
    required: true,
    trim: true
  },
  ownerType: {
    type: String,
    enum: ['COMPANY', 'CUSTOMER', 'UNKNOWN'],
    required: true
  },
  eventType: {
    type: String,
    enum: ['PUTAWAY', 'SHIPMENT', 'REVERSAL', 'ADJUSTMENT', 'RETURN', 'CYCLE_COUNT', 'SCRAP'],
    required: true
  },
  referenceId: {
    type: String,
    required: [true, 'Original transaction reference ID is required (e.g. PutawayTask ID)']
  },
  originalShipmentId: {
    type: String,
    default: null
  },
  quantityChange: {
    type: Number,
    required: true
  },
  unitCostApplied: {
    type: Number,
    required: true,
    min: 0
  },
  priorQty: {
    type: Number,
    required: true,
    min: 0
  },
  priorWac: {
    type: Number,
    required: true,
    min: 0
  },
  priorTotalValue: {
    type: Number,
    required: true,
    min: 0
  },
  newQty: {
    type: Number,
    required: true,
    min: 0
  },
  newWac: {
    type: Number,
    required: true,
    min: 0
  },
  newTotalValue: {
    type: Number,
    required: true,
    min: 0
  },
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  }
}, { 
  timestamps: { createdAt: true, updatedAt: false } // Immutable logs don't have updates
});

// Immutability Guards
inventoryValuationLedgerSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('IMMUTABILITY VIOLATION: InventoryValuationLedger records cannot be modified after creation.');
  }
});

inventoryValuationLedgerSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function() {
  throw new Error('IMMUTABILITY VIOLATION: InventoryValuationLedger updates are strictly forbidden at the database level.');
});

inventoryValuationLedgerSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function() {
  throw new Error('IMMUTABILITY VIOLATION: InventoryValuationLedger deletions are strictly forbidden at the database level.');
});

export default mongoose.model('InventoryValuationLedger', inventoryValuationLedgerSchema);
