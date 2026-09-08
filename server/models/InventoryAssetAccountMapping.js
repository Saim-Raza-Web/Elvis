import mongoose from 'mongoose';

/**
 * InventoryAssetAccountMapping
 *
 * Historical account-role registry. Records which ChartOfAccount served
 * as the active Inventory Asset account for a company, and for which time
 * window. This makes historical GL reconciliation independent of the current
 * CompanyAccountingConfig which is mutable.
 *
 * Invariants:
 *  1. Only ONE mapping per company may have effectiveTo = null at any time
 *     (enforced by sparse partial unique index + pre-save guard).
 *  2. No overlapping date intervals for the same company.
 *  3. effectiveFrom < effectiveTo when effectiveTo is set.
 *  4. account must belong to the same company.
 *  5. Records are never deleted — historical accuracy depends on immutability
 *     of past intervals. An account-role transition closes the old mapping
 *     by setting effectiveTo and creates a new one.
 */
const inventoryAssetAccountMappingSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company is required']
  },
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    required: [true, 'accountId (ChartOfAccount) is required']
  },
  effectiveFrom: {
    type: Date,
    required: [true, 'effectiveFrom is required']
  },
  // null = currently active. Only one null per company allowed.
  effectiveTo: {
    type: Date,
    default: null
  },
  role: {
    type: String,
    enum: ['INVENTORY_ASSET'],
    required: [true, 'role is required'],
    default: 'INVENTORY_ASSET'
  },
  // If this mapping was superseded by another account, record which one.
  transferredTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  notes: {
    type: String,
    default: '',
    trim: true
  },
  createdBy: {
    type: String,
    default: 'System',
    trim: true
  }
}, {
  timestamps: { createdAt: true, updatedAt: false } // Immutable log records
});

// ── Indexes ──────────────────────────────────────────────────────────────────

// Primary lookup: "what accounts served as inventory asset for company C in
// time window [T1, T2]?" — used by historical GL formula.
inventoryAssetAccountMappingSchema.index({ company: 1, effectiveFrom: 1, effectiveTo: 1 });

// "Is account X currently active as inventory asset for company C?" — used
// to validate incoming valuation events.
inventoryAssetAccountMappingSchema.index({ company: 1, accountId: 1, effectiveFrom: 1 }, { unique: true });

// Partial sparse unique index: enforce at most ONE null effectiveTo per company.
// MongoDB partial indexes apply only to documents matching the filter, so
// this index only covers documents where effectiveTo is null.
inventoryAssetAccountMappingSchema.index(
  { company: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { effectiveTo: null },
    name: 'unique_active_mapping_per_company'
  }
);

// ── Pre-save Validation ───────────────────────────────────────────────────────

inventoryAssetAccountMappingSchema.pre('save', async function () {
  // 1. Immutability guard — only new records are allowed through this schema.
  //    Existing records must never be updated; account role transitions work
  //    by closing the old record (setting effectiveTo) and creating a new one.
  //    However, closing an existing mapping (effectiveTo null → date) IS
  //    a permitted modification because it represents the end of a role period.
  //    We allow updating effectiveTo from null to a Date only.
  if (!this.isNew) {
    const changed = this.modifiedPaths();
    const allowedMutations = new Set(['effectiveTo', 'transferredTo', 'notes']);
    const forbiddenChanged = changed.filter(f => !allowedMutations.has(f));
    if (forbiddenChanged.length > 0) {
      throw new Error(
        `IMMUTABILITY VIOLATION: InventoryAssetAccountMapping fields [${forbiddenChanged.join(', ')}] cannot be modified after creation.`
      );
    }
    // Allow only: setting effectiveTo from null to a Date (closing the interval).
    if (changed.includes('effectiveTo')) {
      const original = await this.constructor.findById(this._id).lean();
      if (original.effectiveTo !== null) {
        throw new Error(
          'IMMUTABILITY VIOLATION: effectiveTo cannot be changed once set to a non-null value.'
        );
      }
    }
    return; // existing record — all checks passed
  }

  // 2. Validate effectiveFrom < effectiveTo when effectiveTo is set.
  if (this.effectiveTo !== null && this.effectiveFrom >= this.effectiveTo) {
    throw new Error('Validation Error: effectiveFrom must be strictly before effectiveTo.');
  }

  // 3. Check for overlapping intervals for same company (application-level guard
  //    in addition to the partial unique index). An overlap exists when:
  //    - same company
  //    - existing record's [effectiveFrom, effectiveTo] overlaps with new record's
  //      [effectiveFrom, effectiveTo]
  //    A null effectiveTo means "open end" (still active).
  const newFrom = this.effectiveFrom;
  const newTo   = this.effectiveTo;

  // Safe overlap check: existing record whose interval intersects [newFrom, newTo).
  const overlap = await this.constructor.findOne({
    company: this.company,
    _id: { $ne: this._id },
    effectiveFrom: { $lt: newTo ?? new Date('9999-12-31T23:59:59Z') },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gt: newFrom } }
    ]
  }).lean();

  if (overlap) {
    throw new Error(
      `Overlap Error: An InventoryAssetAccountMapping for this company already covers the requested date interval. ` +
      `Existing mapping: ${overlap.effectiveFrom.toISOString()} → ${overlap.effectiveTo ? overlap.effectiveTo.toISOString() : 'open'}. ` +
      `Close the existing mapping before creating a new one.`
    );
  }
});

// Block update operations that would bypass pre-save immutability guard.
inventoryAssetAccountMappingSchema.pre(['updateMany', 'findOneAndUpdate', 'replaceOne'], function () {
  throw new Error(
    'IMMUTABILITY VIOLATION: Use save() with explicit session to close InventoryAssetAccountMapping records. Bulk updates are forbidden.'
  );
});

// Soft-block deleteOne/deleteMany — historical records must never be lost.
inventoryAssetAccountMappingSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error(
    'IMMUTABILITY VIOLATION: InventoryAssetAccountMapping records cannot be deleted. They are the permanent historical audit trail.'
  );
});

export default mongoose.model('InventoryAssetAccountMapping', inventoryAssetAccountMappingSchema);
