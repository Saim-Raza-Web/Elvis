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
  },
  /**
   * Immutable snapshot of the Inventory Asset ChartOfAccount that was active
   * at the time this valuation event was created.
   *
   * - Populated for ALL new events (PUTAWAY, SHIPMENT, RETURN, CYCLE_COUNT)
   *   where ownerType === 'COMPANY'.
   * - null only on legacy records created before Phase 8B.4 Step 1.
   * - MUST match the accountId used in the corresponding JournalEntry line.
   * - Never overwritten, even if CompanyAccountingConfig changes later.
   */
  inventoryAssetAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
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
