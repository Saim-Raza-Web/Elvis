/**
 * Phase 8B.4 Step 4 — Strict Automated Neutralization Engine
 *
 * READ-ONLY. This service NEVER calls save(), update(), delete(), create(),
 * or any write operation against JournalEntry, InventoryBalance, InventoryCost,
 * InventoryValuationLedger, Product, InventoryAssetAccountMapping, or
 * ReconciliationApprovalEvent.
 *
 * Safety principle: FALSE POSITIVE > FALSE NEGATIVE.
 * When evidence is incomplete, ambiguous, or unresolvable → REVIEW_REQUIRED.
 */

import JournalEntry from '../models/JournalEntry.js';
import InventoryAssetAccountMapping from '../models/InventoryAssetAccountMapping.js';
import ReconciliationApprovalEvent from '../models/ReconciliationApprovalEvent.js';

// ── Classification constants ────────────────────────────────────────────────

export const CLASSIFICATION = Object.freeze({
  NEUTRAL_TRANSFER: 'NEUTRAL_TRANSFER',
  DRIFT: 'DRIFT',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  TIMING_DRIFT: 'TIMING_DRIFT',
});

// ── Approval state machine ───────────────────────────────────────────────────

/**
 * Folds an ordered (by performedAt ASC, _id ASC) array of approval events
 * into a final approval state string.
 *
 * Returns: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'MALFORMED'
 */
export function computeApprovalState(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return 'PENDING';
  }
  const VALID_ACTIONS = new Set(['APPROVE', 'REJECT', 'REVOKE']);
  let state = 'PENDING';
  for (const ev of events) {
    if (!VALID_ACTIONS.has(ev.action)) return 'MALFORMED';
    if (ev.action === 'APPROVE') {
      state = 'APPROVED';
    } else if (ev.action === 'REJECT') {
      state = 'REJECTED';
    } else if (ev.action === 'REVOKE') {
      if (state !== 'APPROVED') return 'MALFORMED';
      state = 'REVOKED';
    }
  }
  return state;
}

// ── Structural JE validators ─────────────────────────────────────────────────

function isStructurallyValidTransfer(je) {
  const lines = je.lines || [];
  if (lines.length !== 2) return false;
  const debits = lines.filter(l => (l.debit || 0) > 0 && (l.credit || 0) === 0);
  const credits = lines.filter(l => (l.credit || 0) > 0 && (l.debit || 0) === 0);
  if (debits.length !== 1 || credits.length !== 1) return false;
  const debitAmt = debits[0].debit;
  const creditAmt = credits[0].credit;
  if (debitAmt <= 0 || creditAmt <= 0) return false;
  const roundedDebit = Math.round(debitAmt * 100);
  const roundedCredit = Math.round(creditAmt * 100);
  if (roundedDebit !== roundedCredit) return false;
  const jeTotalDebit = Math.round((je.totalDebit || 0) * 100);
  const jeTotalCredit = Math.round((je.totalCredit || 0) * 100);
  if (jeTotalDebit !== jeTotalCredit) return false;
  if (jeTotalDebit !== roundedDebit) return false;
  return true;
}

// ── Mapping verification ─────────────────────────────────────────────────────

async function resolveHistoricalMappings(je, companyId) {
  const sourceMappingId = je.sourceDocument?.sourceMappingId;
  const destMappingId = je.sourceDocument?.destMappingId;
  if (!sourceMappingId || !destMappingId) return { ok: false, reason: 'MISSING_MAPPING_IDS' };
  const [sourceMapping, destMapping] = await Promise.all([
    InventoryAssetAccountMapping.findById(sourceMappingId).lean(),
    InventoryAssetAccountMapping.findById(destMappingId).lean(),
  ]);
  if (!sourceMapping) return { ok: false, reason: 'SOURCE_MAPPING_NOT_FOUND' };
  if (!destMapping) return { ok: false, reason: 'DEST_MAPPING_NOT_FOUND' };
  const cStr = companyId.toString();
  if (sourceMapping.company.toString() !== cStr) return { ok: false, reason: 'SOURCE_MAPPING_COMPANY_MISMATCH' };
  if (destMapping.company.toString() !== cStr) return { ok: false, reason: 'DEST_MAPPING_COMPANY_MISMATCH' };
  if (sourceMapping.role !== 'INVENTORY_ASSET') return { ok: false, reason: 'SOURCE_MAPPING_WRONG_ROLE' };
  if (destMapping.role !== 'INVENTORY_ASSET') return { ok: false, reason: 'DEST_MAPPING_WRONG_ROLE' };
  const lines = je.lines || [];
  const debitLine = lines.find(l => (l.debit || 0) > 0);
  const creditLine = lines.find(l => (l.credit || 0) > 0);
  if (!debitLine || !creditLine) return { ok: false, reason: 'MISSING_LINES' };
  const debitAccountId = debitLine.accountId?.toString();
  const creditAccountId = creditLine.accountId?.toString();
  const destAccountId = destMapping.accountId?.toString();
  const sourceAccountId = sourceMapping.accountId?.toString();
  if (debitAccountId && destAccountId && debitAccountId !== destAccountId) return { ok: false, reason: 'DEBIT_LINE_ACCOUNT_MAPPING_MISMATCH' };
  if (creditAccountId && sourceAccountId && creditAccountId !== sourceAccountId) return { ok: false, reason: 'CREDIT_LINE_ACCOUNT_MAPPING_MISMATCH' };
  return { ok: true, sourceMapping, destMapping };
}

// ── Core classification function ─────────────────────────────────────────────

export async function classifyJournalEntry(je, companyId) {
  const result = {
    journalEntryId: je._id?.toString(),
    entryNumber: je.entryNumber,
    date: je.date,
    classification: 'REVIEW_REQUIRED',
    approvalState: null,
    mappingResolution: null,
    reversalInfo: null,
    reasons: [],
    isNeutral: false,
    requiresReview: true,
    mutated: false,
  };

  if (!je.company || je.company.toString() !== companyId.toString()) {
    result.reasons.push('COMPANY_MISMATCH');
    return result;
  }

  const docType = je.sourceDocument?.docType;
  if (docType !== 'inventory_account_transfer') {
    result.classification = 'DRIFT';
    result.requiresReview = false;
    result.reasons.push('NOT_AN_EXPLICIT_TRANSFER');
    return result;
  }

  if (!isStructurallyValidTransfer(je)) {
    result.reasons.push('STRUCTURAL_VALIDATION_FAILED');
    return result;
  }

  const mappingResult = await resolveHistoricalMappings(je, companyId);
  result.mappingResolution = mappingResult.ok ? 'RESOLVED' : mappingResult.reason;
  if (!mappingResult.ok) {
    result.reasons.push('MAPPING_FAILURE:' + mappingResult.reason);
    return result;
  }

  if (je.entryType === 'reversal' && je.reversalOf) {
    result.reasons.push('STANDALONE_REVERSAL_NEEDS_PAIR_CONTEXT');
    return result;
  }

  if (je.status === 'reversed') {
    result.reasons.push('REVERSED_JE_NEEDS_PAIR_CONTEXT');
    return result;
  }

  if (je.status !== 'posted') {
    result.reasons.push('UNEXPECTED_STATUS:' + je.status);
    return result;
  }

  const events = await ReconciliationApprovalEvent.find({
    company: companyId,
    journalEntryId: je._id,
  }).sort({ performedAt: 1, _id: 1 }).lean();

  const approvalState = computeApprovalState(events);
  result.approvalState = approvalState;

  if (approvalState === 'MALFORMED') {
    result.reasons.push('MALFORMED_APPROVAL_SEQUENCE');
    return result;
  }
  if (approvalState === 'PENDING') {
    result.reasons.push('APPROVAL_PENDING');
    return result;
  }
  if (approvalState === 'REJECTED') {
    result.classification = 'DRIFT';
    result.requiresReview = false;
    result.reasons.push('TRANSFER_REJECTED');
    return result;
  }
  if (approvalState === 'REVOKED') {
    result.reasons.push('APPROVAL_REVOKED');
    return result;
  }
  if (approvalState === 'APPROVED') {
    result.classification = 'NEUTRAL_TRANSFER';
    result.isNeutral = true;
    result.requiresReview = false;
    result.reasons.push('ALL_CONDITIONS_SATISFIED');
    return result;
  }

  result.reasons.push('UNEXPECTED_APPROVAL_STATE');
  return result;
}

// ── Pair classification: original + reversal ─────────────────────────────────

export async function classifyTransferPair(originalJe, reversalJe, companyId) {
  const result = {
    journalEntryId: originalJe._id?.toString(),
    reversalJournalEntryId: reversalJe._id?.toString(),
    entryNumber: originalJe.entryNumber,
    date: originalJe.date,
    classification: 'REVIEW_REQUIRED',
    approvalState: null,
    mappingResolution: null,
    reversalInfo: null,
    reasons: [],
    isNeutral: false,
    requiresReview: true,
    mutated: false,
  };

  if (originalJe.company.toString() !== companyId.toString()) { result.reasons.push('ORIGINAL_COMPANY_MISMATCH'); return result; }
  if (reversalJe.company.toString() !== companyId.toString()) { result.reasons.push('REVERSAL_COMPANY_MISMATCH'); return result; }
  if (!reversalJe.reversalOf || reversalJe.reversalOf.toString() !== originalJe._id.toString()) { result.reasons.push('REVERSAL_LINKAGE_MISMATCH'); return result; }
  if (originalJe.sourceDocument?.docType !== 'inventory_account_transfer') { result.reasons.push('ORIGINAL_NOT_AN_EXPLICIT_TRANSFER'); return result; }
  if (reversalJe.sourceDocument?.docType !== 'inventory_account_transfer') { result.reasons.push('REVERSAL_MISSING_TRANSFER_DOCTYPE'); return result; }
  if (!isStructurallyValidTransfer(originalJe)) { result.reasons.push('ORIGINAL_STRUCTURAL_VALIDATION_FAILED'); return result; }
  if (!isStructurallyValidTransfer(reversalJe)) { result.reasons.push('REVERSAL_STRUCTURAL_VALIDATION_FAILED'); return result; }

  const origAmount = Math.round((originalJe.totalDebit || 0) * 100);
  const revAmount = Math.round((reversalJe.totalDebit || 0) * 100);
  if (origAmount !== revAmount) { result.reasons.push('PARTIAL_REVERSAL_AMOUNT_MISMATCH'); return result; }

  const origDebitAccountId = (originalJe.lines.find(l => (l.debit || 0) > 0)?.accountId || '').toString();
  const origCreditAccountId = (originalJe.lines.find(l => (l.credit || 0) > 0)?.accountId || '').toString();
  const revDebitAccountId = (reversalJe.lines.find(l => (l.debit || 0) > 0)?.accountId || '').toString();
  const revCreditAccountId = (reversalJe.lines.find(l => (l.credit || 0) > 0)?.accountId || '').toString();

  if (origDebitAccountId !== revCreditAccountId || origCreditAccountId !== revDebitAccountId) {
    result.reasons.push('REVERSAL_DIRECTION_MISMATCH'); return result;
  }

  const mappingResult = await resolveHistoricalMappings(originalJe, companyId);
  result.mappingResolution = mappingResult.ok ? 'RESOLVED' : mappingResult.reason;
  if (!mappingResult.ok) { result.reasons.push('MAPPING_FAILURE:' + mappingResult.reason); return result; }

  const events = await ReconciliationApprovalEvent.find({
    company: companyId,
    journalEntryId: originalJe._id,
  }).sort({ performedAt: 1, _id: 1 }).lean();

  const approvalState = computeApprovalState(events);
  result.approvalState = approvalState;

  if (approvalState !== 'APPROVED') {
    result.classification = approvalState === 'REJECTED' ? 'DRIFT' : 'REVIEW_REQUIRED';
    result.reasons.push('REVERSAL_PAIR_NOT_APPROVED:' + approvalState);
    return result;
  }

  result.classification = 'NEUTRAL_TRANSFER';
  result.isNeutral = true;
  result.requiresReview = false;
  result.reversalInfo = { reversalJournalEntryId: reversalJe._id.toString(), netAmount: 0 };
  result.reasons.push('APPROVED_PAIR_NET_ZERO');
  return result;
}

// ── Batch reconciliation ─────────────────────────────────────────────────────

export async function runReconciliation(companyId, options = {}) {
  const { startDate, endDate } = options;
  const query = { company: companyId, status: { $in: ['posted', 'reversed'] } };
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date['$gte'] = new Date(startDate);
    if (endDate) query.date['$lte'] = new Date(endDate);
  }

  const allJEs = await JournalEntry.find(query).lean();
  const jeById = new Map(allJEs.map(je => [je._id.toString(), je]));
  const reversalJEs = allJEs.filter(je => je.entryType === 'reversal' && je.reversalOf);
  const claimedOriginalIds = new Set();
  const claimedReversalIds = new Set();
  const results = [];

  for (const revJe of reversalJEs) {
    const origId = revJe.reversalOf.toString();
    const origJe = jeById.get(origId);
    if (!origJe) {
      results.push({
        journalEntryId: revJe._id.toString(), entryNumber: revJe.entryNumber, date: revJe.date,
        classification: 'REVIEW_REQUIRED', approvalState: null, reasons: ['REVERSAL_ORIGINAL_NOT_FOUND'],
        isNeutral: false, requiresReview: true, mutated: false,
      });
      claimedReversalIds.add(revJe._id.toString());
      continue;
    }
    if (origJe.sourceDocument?.docType === 'inventory_account_transfer') {
      const pairResult = await classifyTransferPair(origJe, revJe, companyId);
      results.push(pairResult);
      claimedOriginalIds.add(origId);
      claimedReversalIds.add(revJe._id.toString());
    }
  }

  for (const je of allJEs) {
    const idStr = je._id.toString();
    if (claimedOriginalIds.has(idStr) || claimedReversalIds.has(idStr)) continue;
    const r = await classifyJournalEntry(je, companyId);
    results.push(r);
  }

  results.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return (a.entryNumber || '').localeCompare(b.entryNumber || '');
  });

  return results;
}
