import InventoryAssetAccountMapping from '../models/InventoryAssetAccountMapping.js';

/**
 * InventoryAssetAccountResolver
 *
 * Resolves the currently-active Inventory Asset account for a given company
 * at a given point in time. Used by all valuation call sites (putaway,
 * shipping, cycle count, returns) to capture an immutable account snapshot
 * at event-creation time.
 *
 * This resolver is intentionally separate from CompanyAccountingConfig.
 * CompanyAccountingConfig stores the *current* default and may be changed at
 * any time. InventoryAssetAccountMapping stores the *historical audit trail*
 * of which account was active at each moment. The resolver reads ONLY from
 * the mapping, so the Ledger snapshot remains historically accurate even
 * after a future account transition.
 *
 * HARD FAIL semantics:
 *  - Missing mapping       → throws (cannot record a valuation event without
 *                            knowing which account to debit/credit)
 *  - Multiple active maps  → throws (data integrity violation — partial unique
 *                            index + pre-save guard should prevent this, but
 *                            the resolver double-checks)
 *  - Wrong-company account → throws (tenant isolation)
 *
 * @param {string|ObjectId} company   — company ObjectId
 * @param {Date}            [asOf]    — point-in-time (default: now)
 * @param {object}          [session] — optional Mongoose session (for
 *                                      session-aware reads inside transactions)
 * @returns {ObjectId} The accountId of the active Inventory Asset account
 * @throws  {Error}    Hard-fail if no active mapping exists
 */
export async function resolveActiveInventoryAssetAccount(company, asOf = new Date(), session = null) {
  if (!company) {
    throw new Error('HARD ACCOUNTING EXCEPTION: company is required for InventoryAssetAccountResolver.');
  }

  const query = InventoryAssetAccountMapping.find({
    company,
    effectiveFrom: { $lte: asOf },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gt: asOf } }
    ]
  }).lean();

  if (session) {
    query.session(session);
  }

  const matches = await query;

  if (matches.length === 0) {
    throw new Error(
      `HARD ACCOUNTING EXCEPTION: No active InventoryAssetAccountMapping found for company ` +
      `${company} at ${asOf.toISOString()}. ` +
      `Create a mapping via InventoryAssetAccountMapping before recording valuation events.`
    );
  }

  if (matches.length > 1) {
    // This should never happen due to the partial unique index, but double-check at runtime.
    const ids = matches.map(m => m._id.toString()).join(', ');
    throw new Error(
      `DATA INTEGRITY VIOLATION: Multiple active InventoryAssetAccountMappings found for ` +
      `company ${company} at ${asOf.toISOString()}. Mapping IDs: [${ids}]. ` +
      `This must be resolved before further valuation events can be recorded.`
    );
  }

  return matches[0].accountId;
}
