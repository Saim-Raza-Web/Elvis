import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import LocationOverride from '../models/LocationOverride.js';
import TaskSuggestionRejection from '../models/TaskSuggestionRejection.js';
import PutawayTask from '../models/PutawayTask.js';
import PickTask from '../models/PickTask.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import AuditLog from '../models/AuditLog.js';
import Notification from '../models/Notification.js';
import Warehouse from '../models/Warehouse.js';
import { IdempotencyService } from '../services/IdempotencyService.js';
import {
  putawayEngine,
  calculateLocationActiveWeight,
  resolveDefaultLevelLimit,
  getSiblingLocationsOnLevel
} from '../services/putawayEngine.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

const CANONICAL_REASON_CODES = [
  'SPACE_CONSTRAINT',
  'CUSTOMER_REQUEST',
  'DAMAGE',
  'WEIGHT_LIMIT',
  'TEMPERATURE_MISMATCH',
  'OTHER'
];

function normalizePayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizePayload);
  const sorted = {};
  for (const k of Object.keys(obj).sort()) {
    if (k === 'idempotencyKey') continue;
    sorted[k] = normalizePayload(obj[k]);
  }
  return sorted;
}

function validateReason(reasonCode, reasonText) {
  if (!reasonCode || !CANONICAL_REASON_CODES.includes(reasonCode)) {
    return `Invalid canonical reason code. Allowed: ${CANONICAL_REASON_CODES.join(', ')}`;
  }
  if (reasonCode === 'OTHER') {
    if (!reasonText || typeof reasonText !== 'string' || reasonText.trim().length < 10) {
      return "reasonText is mandatory and must be at least 10 characters when reasonCode is 'OTHER'.";
    }
  }
  return null;
}

async function validateHardSafetyConstraints({
  companyId,
  warehouseCode,
  targetBinCode,
  productDoc,
  owner,
  lotNumber,
  incomingQty = 1,
  incomingPalletWeight = null,
  session
}) {
  const loc = await Location.findOne({
    code: targetBinCode.toUpperCase(),
    company: companyId
  }).session(session);

  if (!loc) {
    return { ok: false, status: 400, message: `Destination bin '${targetBinCode}' does not exist in Location master.` };
  }

  if (loc.active === false) {
    return { ok: false, status: 400, message: `Location '${targetBinCode}' is inactive. Overrides to inactive bins are prohibited.` };
  }

  if (loc.status === 'LOCKED' || loc.status === 'MAINTENANCE' || loc.status === 'BLOCKED') {
    return { ok: false, status: 400, message: `Location '${targetBinCode}' is currently locked for ${loc.status}. Putaway/pick blocked.` };
  }

  // Cold Chain Compatibility
  if (productDoc) {
    const isColdProduct = Boolean(
      productDoc.isColdStorage ||
      productDoc.tracking_type === 'LOT_EXPIRY' ||
      productDoc.category?.toUpperCase().includes('COLD') ||
      productDoc.temperature_range?.toUpperCase().includes('REFRIGERATED') ||
      productDoc.temperature_range?.toUpperCase().includes('FROZEN')
    );

    if (isColdProduct && loc.zoneType !== 'COLD_STORAGE') {
      return {
        ok: false,
        status: 400,
        message: `Storage Compatibility Violation: SKU '${productDoc.sku}' requires COLD_STORAGE zone, but '${targetBinCode}' is '${loc.zoneType || 'AMBIENT'}'.`
      };
    }

    const isHazmatProduct = Boolean(
      productDoc.isHazmat ||
      productDoc.hazmat_class === 'HAZMAT' ||
      productDoc.hazmat_class === 'CHEMICAL' ||
      productDoc.category?.toUpperCase().includes('HAZ')
    );

    if (isHazmatProduct && loc.zoneType !== 'HAZMAT' && loc.locationType !== 'HAZMAT') {
      return {
        ok: false,
        status: 400,
        message: `Storage Compatibility Violation: SKU '${productDoc.sku}' is HAZMAT, but '${targetBinCode}' is not a dedicated HAZMAT zone.`
      };
    }
  }

  // 3PL Lot Integrity Invariant: 1 Location = 1 Lot + 1 SKU + 1 Owner
  const existingBalances = await InventoryBalance.find({
    company: companyId,
    bin: loc.code,
    $or: [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }, { qtyAwaitingPutaway: { $gt: 0 } }]
  }).session(session);

  if (existingBalances.length > 0) {
    if (owner && existingBalances.some(b => b.owner && b.owner.trim().toLowerCase() !== owner.trim().toLowerCase())) {
      return {
        ok: false,
        status: 400,
        message: `Lot Integrity Violation: Location ${loc.code} is occupied by another 3PL Owner ('${existingBalances.find(b => b.owner !== owner)?.owner}').`
      };
    }
    if (productDoc?.sku && existingBalances.some(b => b.sku && b.sku !== productDoc.sku)) {
      return {
        ok: false,
        status: 400,
        message: `Lot Integrity Violation: Location ${loc.code} is occupied by another SKU ('${existingBalances.find(b => b.sku !== productDoc.sku)?.sku}').`
      };
    }
    if (lotNumber && existingBalances.some(b => b.lotNumber && b.lotNumber !== lotNumber)) {
      return {
        ok: false,
        status: 400,
        message: `Lot Integrity Violation: Location ${loc.code} is occupied by another Lot Number ('${existingBalances.find(b => b.lotNumber !== lotNumber)?.lotNumber}').`
      };
    }
  }

  // Weight Limits Revalidation
  const { currentWeight: currentLocWeight } = await calculateLocationActiveWeight(companyId, loc.code);
  const palletTare = 25;
  const singlePalletGross = (incomingPalletWeight || productDoc?.pallet_weight_kg || 0) + palletTare;
  const totalIncomingWeight = singlePalletGross > 25 ? (incomingQty * singlePalletGross) : (incomingQty * (productDoc?.weight || 10));

  const locLimit = (loc.max_weight_kg !== null && loc.max_weight_kg !== undefined && loc.max_weight_kg > 0)
    ? loc.max_weight_kg
    : (loc.weight_limit !== null && loc.weight_limit !== undefined && loc.weight_limit > 0)
      ? loc.weight_limit
      : (loc.weightCapacity || loc.maxWeight || 1000);

  if ((currentLocWeight + totalIncomingWeight) > locLimit) {
    return {
      ok: false,
      status: 400,
      message: `Individual Weight Limit Exceeded: current ${currentLocWeight}kg + incoming ${totalIncomingWeight}kg exceeds max_weight_kg ${locLimit}kg.`
    };
  }

  const levelLimit = resolveDefaultLevelLimit(loc);
  const siblings = await getSiblingLocationsOnLevel(companyId, loc);
  let currentLevelWeight = 0;
  for (const sib of siblings) {
    const { currentWeight: sibW } = await calculateLocationActiveWeight(companyId, sib.code);
    currentLevelWeight += sibW;
  }

  if ((currentLevelWeight + totalIncomingWeight) > levelLimit) {
    return {
      ok: false,
      status: 400,
      message: `Aggregate Level Weight Limit Exceeded: level current ${currentLevelWeight}kg + incoming ${totalIncomingWeight}kg exceeds level_weight_limit ${levelLimit}kg.`
    };
  }

  return { ok: true, location: loc };
}

// ── 1. POST /tasks/:taskId/reject-suggestion ───────────────────────────────────
router.post('/tasks/:taskId/reject-suggestion', async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
  let idempLock = null;

  if (idempotencyKey) {
    try {
      idempLock = await IdempotencyService.acquireLock(
        req.user.company,
        'OVERRIDE_REJECT_SUGGESTION',
        idempotencyKey,
        normalizePayload(req.body)
      );
      if (idempLock.status === 'CACHED') {
        return res.status(200).json(idempLock.response);
      }
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ message: err.message });
      return next(err);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { taskId } = req.params;
    const { taskType = 'putaway', taskLineId = null, scannedLocation, reasonCode, reasonText } = req.body;

    if (!['putaway', 'picking'].includes(taskType)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Task type must be 'putaway' or 'picking'. Received: '${taskType}'` });
    }

    const reasonErr = validateReason(reasonCode, reasonText);
    if (reasonErr) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: reasonErr });
    }

    if (!scannedLocation || !String(scannedLocation).trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'scannedLocation is required to record a suggestion rejection.' });
    }

    // Resolve Authoritative Task
    let taskDoc = null;
    let taskWarehouseCode = '';
    let targetSku = '';
    let targetQty = 1;
    let targetOwner = '';
    let targetLot = '';

    if (taskType === 'putaway') {
      taskDoc = await PutawayTask.findOne({
        $or: [{ taskId }, { _id: mongoose.isValidObjectId(taskId) ? taskId : null }],
        company: req.user.company
      }).session(session);

      if (!taskDoc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: `Putaway task '${taskId}' not found for this tenant.` });
      }

      if (['completed', 'cancelled'].includes(taskDoc.status)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Cannot reject suggestions for putaway task ${taskDoc.taskId} with status '${taskDoc.status}'.` });
      }

      taskWarehouseCode = (taskDoc.warehouse || 'MIA').toUpperCase();
      targetSku = taskDoc.sku;
      targetQty = taskDoc.qty;
      targetOwner = taskDoc.owner;
      targetLot = taskDoc.lotNumber || '';
    } else {
      // Picking Task
      taskDoc = await PickTask.findOne({
        $or: [{ taskId }, { _id: mongoose.isValidObjectId(taskId) ? taskId : null }],
        company: req.user.company
      }).session(session);

      if (!taskDoc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: `Pick task '${taskId}' not found for this tenant.` });
      }

      if (['completed', 'cancelled'].includes(taskDoc.status)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Cannot reject suggestions for pick task ${taskDoc.taskId} with status '${taskDoc.status}'.` });
      }

      if (!taskLineId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'taskLineId is mandatory for picking task suggestion rejections.' });
      }

      const lineItem = taskDoc.items?.id(taskLineId);
      if (!lineItem) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: `Line item '${taskLineId}' not found on PickTask '${taskDoc.taskId}'.` });
      }

      taskWarehouseCode = (taskDoc.warehouse || 'MIA').toUpperCase();
      targetSku = lineItem.sku;
      targetQty = lineItem.orderedQty;
      targetOwner = lineItem.inventoryOwner || taskDoc.owner;
    }

    // Verify warehouse matches context (middleware or header)
    const activeWarehouseCode = (
      req.context?.warehouse?.code ||
      req.headers['warehouse'] ||
      req.headers['x-warehouse'] ||
      req.headers['x-warehouse-code'] ||
      req.query.warehouse ||
      req.body?.warehouse ||
      ''
    ).toString().toUpperCase();

    if (activeWarehouseCode && activeWarehouseCode !== taskWarehouseCode) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: `Warehouse context mismatch: Task belongs to warehouse '${taskWarehouseCode}', but active context is '${activeWarehouseCode}'.`
      });
    }

    const whDoc = await Warehouse.findOne({
      code: taskWarehouseCode,
      company: req.user.company
    }).session(session);

    const warehouseId = whDoc ? whDoc._id : req.user.company;

    // 1. Record Immutable TaskSuggestionRejection
    const rejectionDoc = await TaskSuggestionRejection.create([{
      company: req.user.company,
      warehouse: taskWarehouseCode,
      warehouseId,
      taskId: taskDoc.taskId,
      taskLineId: taskLineId ? new mongoose.Types.ObjectId(taskLineId) : null,
      taskType,
      suggestedLocation: scannedLocation.trim().toUpperCase(),
      reasonCode,
      reasonText: reasonText || '',
      rejectedBy: req.user._id,
      rejectedAt: new Date(),
      escalated: false
    }], { session });

    // 2. Query exact task-line rejection count (company + taskId + taskLineId)
    const taskLineQuery = {
      company: req.user.company,
      taskId: taskDoc.taskId,
      taskLineId: taskLineId ? new mongoose.Types.ObjectId(taskLineId) : null
    };

    const taskRejections = await TaskSuggestionRejection.find(taskLineQuery).sort({ rejectedAt: 1 }).session(session);
    const rejectionCount = taskRejections.length;

    // 3. Concurrency-safe Rolling 24-Hour Warehouse Escalation Check
    // (company + warehouse + reasonCode, rejectedAt >= now - 24h)
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const unescalatedRejections = await TaskSuggestionRejection.find({
      company: req.user.company,
      warehouse: taskWarehouseCode,
      reasonCode,
      escalated: false,
      rejectedAt: { $gte: windowStart }
    }).session(session);

    let triggeredEscalation = false;
    let escalatedAlertId = null;

    if (unescalatedRejections.length >= 3) {
      triggeredEscalation = true;
      escalatedAlertId = `ALERT-ESC-${req.user.company}-${taskWarehouseCode}-${reasonCode}-${rejectionDoc[0]._id}`;
      const unescalatedIds = unescalatedRejections.map(r => r._id);

      // Atomically claim cluster
      await TaskSuggestionRejection.updateMany(
        { _id: { $in: unescalatedIds } },
        { $set: { escalated: true, escalatedAlertId } },
        { session }
      );

      // Record immutable AuditLog event for escalation
      await AuditLog.create([{
        event_id: 'EVT-ESC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        timestamp: new Date(),
        event_type: 'override_escalated',
        user_id: req.user._id,
        user_name: req.user.name || req.user.email || 'Operator',
        reference_id: taskDoc.taskId,
        reason_code_canonical: reasonCode,
        reason_text: `Warehouse facility threshold reached: 3 rejections for '${reasonCode}' within 24 hours in ${taskWarehouseCode}.`,
        company: req.user.company
      }], { session });
    }

    // 4. Calculate Next Suggestion or Transition to NEEDS_REVIEW
    const excludedLocations = taskRejections.map(r => r.suggestedLocation.toUpperCase());
    let nextSuggestion = null;

    if (rejectionCount < 3) {
      if (taskType === 'putaway') {
        const prod = await Product.findOne({ sku: targetSku, company: req.user.company }).session(session);
        const engineResult = await putawayEngine.evaluatePutawayLocation({
          companyId: req.user.company,
          warehouse: taskWarehouseCode,
          sku: targetSku,
          category: prod?.category,
          owner: targetOwner,
          lotNumber: targetLot,
          qty: targetQty,
          isHazmat: Boolean(prod?.isHazmat),
          excludedLocations
        });

        if (engineResult && engineResult.success && engineResult.proposedBin) {
          nextSuggestion = engineResult.proposedBin;
        }
      } else {
        // Picking next suggestion from eligible inventory balances
        const alternateBalances = await InventoryBalance.find({
          company: req.user.company,
          warehouse: taskWarehouseCode,
          sku: targetSku,
          qtyAvailable: { $gt: 0 },
          bin: { $nin: excludedLocations }
        }).session(session);

        if (alternateBalances.length > 0) {
          nextSuggestion = alternateBalances[0].bin;
        }
      }
    }

    // 5. If rejection count >= 3 OR no candidates remain -> Create LocationOverride in NEEDS_REVIEW
    let createdOverride = null;

    if (rejectionCount >= 3 || !nextSuggestion) {
      const existingActiveOverride = await LocationOverride.findOne({
        company: req.user.company,
        taskId: taskDoc.taskId,
        taskLineId: taskLineId ? new mongoose.Types.ObjectId(taskLineId) : null,
        status: { $in: ['PENDING', 'NEEDS_REVIEW'] }
      }).session(session);

      if (existingActiveOverride) {
        createdOverride = existingActiveOverride;
      } else {
        const proposedBase = (taskType === 'putaway' ? (taskDoc.toLocation || taskDoc.destinationBin) : (taskDoc.items?.id(taskLineId)?.sourceLocation)) || scannedLocation;
        const newOverride = await LocationOverride.create([{
          company: req.user.company,
          warehouse: taskWarehouseCode,
          warehouseId,
          taskId: taskDoc.taskId,
          taskLineId: taskLineId ? new mongoose.Types.ObjectId(taskLineId) : null,
          taskType,
          sourceModel: taskType === 'putaway' ? 'PutawayTask' : 'PickTask',
          taskRef: taskDoc._id,
          proposedLocation: proposedBase,
          overrideLocation: null,
          reasonCode,
          reasonText: reasonText || `Automated transition to NEEDS_REVIEW after ${rejectionCount} suggestion rejections.`,
          status: 'NEEDS_REVIEW',
          requestedBy: req.user._id,
          requestedByEmail: req.user.email || '',
          rejectionCount,
          rejectionHistory: taskRejections.map(r => ({
            suggestedLocation: r.suggestedLocation,
            reasonCode: r.reasonCode,
            reasonText: r.reasonText,
            rejectedBy: r.rejectedBy,
            rejectedAt: r.rejectedAt
          })),
          escalation: {
            isEscalated: triggeredEscalation,
            escalatedAt: triggeredEscalation ? new Date() : null,
            alertId: escalatedAlertId
          }
        }], { session });

        createdOverride = newOverride[0];

        // Audit Log for override_requested (NEEDS_REVIEW)
        await AuditLog.create([{
          event_id: 'EVT-OVR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          timestamp: new Date(),
          event_type: 'override_requested',
          user_id: req.user._id,
          user_name: req.user.name || req.user.email || 'Operator',
          reference_id: taskDoc.taskId,
          reason_code_canonical: reasonCode,
          reason_text: `Location suggestions exhausted. Task placed in NEEDS_REVIEW.`,
          company: req.user.company
        }], { session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    // 6. Non-blocking Notification creation outside MongoDB transaction
    if (triggeredEscalation && escalatedAlertId) {
      Notification.create({
        company: req.user.company,
        kind: 'warning',
        title: `Supervisor Alert: Repeated Rejections for ${reasonCode} in ${taskWarehouseCode}`,
        body: `Facility threshold reached: 3 rejections recorded for reason '${reasonCode}' within 24 hours in warehouse ${taskWarehouseCode}. Alert ID: ${escalatedAlertId}.`
      }).catch(err => console.error('[Overrides] Notification dispatch failed (non-blocking):', err.message));
    }

    const responsePayload = {
      success: true,
      taskId: taskDoc.taskId,
      taskLineId: taskLineId || null,
      rejectionCount,
      status: (rejectionCount >= 3 || !nextSuggestion) ? 'NEEDS_REVIEW' : 'PENDING',
      nextSuggestion: nextSuggestion || null,
      escalated: triggeredEscalation,
      overrideId: createdOverride ? createdOverride._id : null,
      message: (rejectionCount >= 3 || !nextSuggestion)
        ? `Suggestions exhausted (${rejectionCount} rejections). Task line placed in NEEDS_REVIEW for supervisor resolution.`
        : `Suggestion rejected. Suggestion ${rejectionCount + 1} presented: ${nextSuggestion}`
    };

    if (idempLock?.record?._id) {
      await IdempotencyService.completeLock(idempLock.record._id, responsePayload);
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (idempLock?.record?._id) {
      await IdempotencyService.failLock(idempLock.record._id, err);
    }
    if (err.name === 'VersionError' || err.code === 112 || err.hasErrorLabel?.('TransientTransactionError') || err.message?.includes('Write conflict') || err.message?.includes('WriteConflict')) {
      return res.status(409).json({ message: 'Concurrent modification conflict. Please retry.' });
    }
    next(err);
  }
});

// ── 2. POST / (Create Explicit Override) ────────────────────────────────────────
router.post('/', async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
  let idempLock = null;

  if (idempotencyKey) {
    try {
      idempLock = await IdempotencyService.acquireLock(
        req.user.company,
        'OVERRIDE_CREATE',
        idempotencyKey,
        normalizePayload(req.body)
      );
      if (idempLock.status === 'CACHED') {
        return res.status(200).json(idempLock.response);
      }
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ message: err.message });
      return next(err);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { taskId, taskLineId = null, taskType = 'putaway', overrideLocation, reasonCode, reasonText } = req.body;

    if (!taskId || !String(taskId).trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'taskId is required.' });
    }

    if (!['putaway', 'picking'].includes(taskType)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Task type must be 'putaway' or 'picking'. Received: '${taskType}'` });
    }

    if (!overrideLocation || !String(overrideLocation).trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'overrideLocation is required for explicit override requests.' });
    }

    const reasonErr = validateReason(reasonCode, reasonText);
    if (reasonErr) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: reasonErr });
    }

    // Resolve Authoritative Task
    let taskDoc = null;
    let proposedLocation = '';
    let productDoc = null;
    let owner = '';
    let lotNumber = '';
    let qty = 1;

    if (taskType === 'putaway') {
      taskDoc = await PutawayTask.findOne({
        $or: [{ taskId }, { _id: mongoose.isValidObjectId(taskId) ? taskId : null }],
        company: req.user.company
      }).session(session);

      if (!taskDoc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: `Putaway task '${taskId}' not found.` });
      }

      if (['completed', 'cancelled'].includes(taskDoc.status)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Task ${taskDoc.taskId} has status '${taskDoc.status}'. Overrides are prohibited.` });
      }

      proposedLocation = taskDoc.toLocation || taskDoc.destinationBin || 'Z-RECEIVING';
      productDoc = await Product.findOne({ sku: taskDoc.sku, company: req.user.company }).session(session);
      owner = taskDoc.owner;
      lotNumber = taskDoc.lotNumber || '';
      qty = taskDoc.qty;
    } else {
      taskDoc = await PickTask.findOne({
        $or: [{ taskId }, { _id: mongoose.isValidObjectId(taskId) ? taskId : null }],
        company: req.user.company
      }).session(session);

      if (!taskDoc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: `Pick task '${taskId}' not found.` });
      }

      if (['completed', 'cancelled'].includes(taskDoc.status)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Task ${taskDoc.taskId} has status '${taskDoc.status}'. Overrides are prohibited.` });
      }

      if (!taskLineId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'taskLineId is required for picking overrides.' });
      }

      const lineItem = taskDoc.items?.id(taskLineId);
      if (!lineItem) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: `Pick line '${taskLineId}' not found on task '${taskDoc.taskId}'.` });
      }

      proposedLocation = lineItem.sourceLocation || 'STAGING-A';
      productDoc = await Product.findOne({ sku: lineItem.sku, company: req.user.company }).session(session);
      owner = lineItem.inventoryOwner || taskDoc.owner;
      qty = lineItem.orderedQty;
    }

    const taskWarehouseCode = (taskDoc.warehouse || 'MIA').toUpperCase();
    const activeWarehouseCode = (
      req.context?.warehouse?.code ||
      req.headers['warehouse'] ||
      req.headers['x-warehouse'] ||
      req.headers['x-warehouse-code'] ||
      req.query.warehouse ||
      req.body?.warehouse ||
      ''
    ).toString().toUpperCase();

    if (activeWarehouseCode && activeWarehouseCode !== taskWarehouseCode) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: `Warehouse context mismatch: Task warehouse '${taskWarehouseCode}' != context '${activeWarehouseCode}'.` });
    }

    const whDoc = await Warehouse.findOne({ code: taskWarehouseCode, company: req.user.company }).session(session);
    const warehouseId = whDoc ? whDoc._id : req.user.company;

    // Check duplicate active override constraint
    const activeQuery = {
      company: req.user.company,
      taskId: taskDoc.taskId,
      taskLineId: taskLineId ? new mongoose.Types.ObjectId(taskLineId) : null,
      status: { $in: ['PENDING', 'NEEDS_REVIEW'] }
    };

    const existingActive = await LocationOverride.findOne(activeQuery).session(session);
    if (existingActive) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        message: `An active override request already exists for Task '${taskDoc.taskId}' in status '${existingActive.status}'.`
      });
    }

    // Hard Safety Revalidation for candidate overrideLocation
    const safetyCheck = await validateHardSafetyConstraints({
      companyId: req.user.company,
      warehouseCode: taskWarehouseCode,
      targetBinCode: overrideLocation.trim().toUpperCase(),
      productDoc,
      owner,
      lotNumber,
      incomingQty: qty,
      session
    });

    if (!safetyCheck.ok) {
      await session.abortTransaction();
      session.endSession();
      return res.status(safetyCheck.status).json({ message: safetyCheck.message });
    }

    // Auto-approve if requested by admin/manager
    const isAutoApprove = req.user.role === 'admin' || req.user.role === 'manager';
    const initialStatus = isAutoApprove ? 'APPROVED' : 'PENDING';

    // Create LocationOverride with appropriate status
    const created = await LocationOverride.create([{
      company: req.user.company,
      warehouse: taskWarehouseCode,
      warehouseId,
      taskId: taskDoc.taskId,
      taskLineId: taskLineId ? new mongoose.Types.ObjectId(taskLineId) : null,
      taskType,
      sourceModel: taskType === 'putaway' ? 'PutawayTask' : 'PickTask',
      taskRef: taskDoc._id,
      proposedLocation: proposedLocation.trim().toUpperCase(),
      overrideLocation: overrideLocation.trim().toUpperCase(),
      reasonCode,
      reasonText: reasonText || '',
      status: initialStatus,
      requestedBy: req.user._id,
      requestedByEmail: req.user.email || '',
      authorizedBy: isAutoApprove ? req.user._id : null,
      authorizedByEmail: isAutoApprove ? req.user.email || '' : '',
      authorizedAt: isAutoApprove ? new Date() : null,
      rejectionCount: 0,
      rejectionHistory: []
    }], { session });

    // Record immutable AuditLog event
    await AuditLog.create([{
      event_id: 'EVT-OVR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date(),
      event_type: 'override_requested',
      user_id: req.user._id,
      user_name: req.user.name || req.user.email || 'Operator',
      location_code_from: proposedLocation.trim().toUpperCase(),
      location_code_to: overrideLocation.trim().toUpperCase(),
      sku: productDoc?._id,
      quantity: qty,
      reference_id: taskDoc.taskId,
      reason_code_canonical: reasonCode,
      reason_text: reasonText || `Operator requested explicit location override to '${overrideLocation}'.`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    const responsePayload = {
      success: true,
      override: created[0]
    };

    if (idempLock?.record?._id) {
      await IdempotencyService.completeLock(idempLock.record._id, responsePayload);
    }

    return res.status(201).json(responsePayload);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (idempLock?.record?._id) {
      await IdempotencyService.failLock(idempLock.record._id, err);
    }
    if (err.name === 'VersionError' || err.code === 112 || err.hasErrorLabel?.('TransientTransactionError') || err.message?.includes('Write conflict') || err.message?.includes('WriteConflict')) {
      return res.status(409).json({ message: 'Concurrent modification conflict. Please retry.' });
    }
    next(err);
  }
});

// ── 3. POST /:id/approve ───────────────────────────────────────────────────────
router.post('/:id/approve', requireRole('admin', 'manager'), async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
  let idempLock = null;

  if (idempotencyKey) {
    try {
      idempLock = await IdempotencyService.acquireLock(
        req.user.company,
        'OVERRIDE_APPROVE',
        idempotencyKey,
        normalizePayload(req.body)
      );
      if (idempLock.status === 'CACHED') {
        return res.status(200).json(idempLock.response);
      }
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ message: err.message });
      return next(err);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const override = await LocationOverride.findOne({
      _id: req.params.id,
      company: req.user.company
    }).session(session);

    if (!override) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Location override record not found.' });
    }

    // Separation of duties
    if (String(override.requestedBy) === String(req.user._id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: 'Separation of duties violation: Operators cannot approve their own override requests.'
      });
    }

    // State transition guard
    if (!['PENDING', 'NEEDS_REVIEW'].includes(override.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Invalid transition: Cannot approve override currently in '${override.status}' state.`
      });
    }

    const finalOverrideLocation = (req.body.overrideLocation || override.overrideLocation || '').trim().toUpperCase();
    if (!finalOverrideLocation) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'An overrideLocation must be defined to approve an override.' });
    }

    // Validate Hard Safety Constraints on the final override location
    const safetyCheck = await validateHardSafetyConstraints({
      companyId: req.user.company,
      warehouseCode: override.warehouse,
      targetBinCode: finalOverrideLocation,
      session
    });

    if (!safetyCheck.ok) {
      await session.abortTransaction();
      session.endSession();
      return res.status(safetyCheck.status).json({ message: safetyCheck.message });
    }

    // Transition state
    override.status = 'APPROVED';
    override.overrideLocation = finalOverrideLocation;
    override.authorizedBy = req.user._id;
    override.authorizedByEmail = req.user.email || req.user.name || 'Supervisor';
    override.authorizedAt = new Date();
    if (req.body.notes) override.notes = req.body.notes;

    await override.save({ session });

    // Record immutable AuditLog event
    await AuditLog.create([{
      event_id: 'EVT-APP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date(),
      event_type: 'override_approved',
      user_id: req.user._id,
      user_name: req.user.name || req.user.email || 'Supervisor',
      location_code_from: override.proposedLocation,
      location_code_to: override.overrideLocation,
      reference_id: override.taskId,
      reason_code_canonical: override.reasonCode,
      reason_text: req.body.notes || `Location override authorized by supervisor for Task '${override.taskId}'.`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    const responsePayload = {
      success: true,
      override
    };

    if (idempLock?.record?._id) {
      await IdempotencyService.completeLock(idempLock.record._id, responsePayload);
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (idempLock?.record?._id) {
      await IdempotencyService.failLock(idempLock.record._id, err);
    }
    if (err.name === 'VersionError' || err.code === 112 || err.hasErrorLabel?.('TransientTransactionError') || err.message?.includes('Write conflict') || err.message?.includes('WriteConflict')) {
      return res.status(409).json({ message: 'Concurrent modification conflict. Please retry.' });
    }
    next(err);
  }
});

// ── 4. POST /:id/reject ────────────────────────────────────────────────────────
router.post('/:id/reject', requireRole('admin', 'manager'), async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
  let idempLock = null;

  if (idempotencyKey) {
    try {
      idempLock = await IdempotencyService.acquireLock(
        req.user.company,
        'OVERRIDE_REJECT',
        idempotencyKey,
        normalizePayload(req.body)
      );
      if (idempLock.status === 'CACHED') {
        return res.status(200).json(idempLock.response);
      }
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ message: err.message });
      return next(err);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const override = await LocationOverride.findOne({
      _id: req.params.id,
      company: req.user.company
    }).session(session);

    if (!override) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Location override record not found.' });
    }

    if (!['PENDING', 'NEEDS_REVIEW'].includes(override.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Invalid transition: Cannot reject override currently in '${override.status}' state.`
      });
    }

    const rejectionRationale = (req.body.notes || req.body.reason || '').trim();
    if (!rejectionRationale) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'A rejection rationale/notes is mandatory to deny an override.' });
    }

    override.status = 'REJECTED';
    override.authorizedBy = req.user._id;
    override.authorizedByEmail = req.user.email || req.user.name || 'Supervisor';
    override.authorizedAt = new Date();
    override.notes = rejectionRationale;

    await override.save({ session });

    // Record immutable AuditLog event
    await AuditLog.create([{
      event_id: 'EVT-REJ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date(),
      event_type: 'override_rejected',
      user_id: req.user._id,
      user_name: req.user.name || req.user.email || 'Supervisor',
      location_code_from: override.proposedLocation,
      location_code_to: override.overrideLocation || undefined,
      reference_id: override.taskId,
      reason_code_canonical: override.reasonCode,
      reason_text: `Supervisor rejected override request: ${rejectionRationale}`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    const responsePayload = {
      success: true,
      override
    };

    if (idempLock?.record?._id) {
      await IdempotencyService.completeLock(idempLock.record._id, responsePayload);
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (idempLock?.record?._id) {
      await IdempotencyService.failLock(idempLock.record._id, err);
    }
    if (err.name === 'VersionError' || err.code === 112 || err.hasErrorLabel?.('TransientTransactionError') || err.message?.includes('Write conflict') || err.message?.includes('WriteConflict')) {
      return res.status(409).json({ message: 'Concurrent modification conflict. Please retry.' });
    }
    next(err);
  }
});

// ── 5. POST /:id/resolve ───────────────────────────────────────────────────────
router.post('/:id/resolve', requireRole('admin', 'manager'), async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
  let idempLock = null;

  if (idempotencyKey) {
    try {
      idempLock = await IdempotencyService.acquireLock(
        req.user.company,
        'OVERRIDE_RESOLVE',
        idempotencyKey,
        normalizePayload(req.body)
      );
      if (idempLock.status === 'CACHED') {
        return res.status(200).json(idempLock.response);
      }
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ message: err.message });
      return next(err);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const override = await LocationOverride.findOne({
      _id: req.params.id,
      company: req.user.company
    }).session(session);

    if (!override) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Location override record not found.' });
    }

    if (override.status !== 'NEEDS_REVIEW') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Invalid operation: Resolve is only valid for overrides in 'NEEDS_REVIEW' status. Current: '${override.status}'`
      });
    }

    const { assignedLocation, notes } = req.body;
    if (!assignedLocation || !String(assignedLocation).trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'assignedLocation is required to resolve NEEDS_REVIEW.' });
    }

    const cleanAssignedLoc = assignedLocation.trim().toUpperCase();

    // Revalidate Hard Safety Constraints on assignedLocation
    const safetyCheck = await validateHardSafetyConstraints({
      companyId: req.user.company,
      warehouseCode: override.warehouse,
      targetBinCode: cleanAssignedLoc,
      session
    });

    if (!safetyCheck.ok) {
      await session.abortTransaction();
      session.endSession();
      return res.status(safetyCheck.status).json({ message: safetyCheck.message });
    }

    override.overrideLocation = cleanAssignedLoc;
    override.status = 'APPROVED';
    override.authorizedBy = req.user._id;
    override.authorizedByEmail = req.user.email || req.user.name || 'Supervisor';
    override.authorizedAt = new Date();
    if (notes) override.notes = notes;

    await override.save({ session });

    // Record immutable AuditLog event
    await AuditLog.create([{
      event_id: 'EVT-RES-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date(),
      event_type: 'override_resolved',
      user_id: req.user._id,
      user_name: req.user.name || req.user.email || 'Supervisor',
      location_code_from: override.proposedLocation,
      location_code_to: cleanAssignedLoc,
      reference_id: override.taskId,
      reason_code_canonical: override.reasonCode,
      reason_text: notes || `Supervisor resolved NEEDS_REVIEW by manually assigning destination location '${cleanAssignedLoc}'.`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    const responsePayload = {
      success: true,
      override
    };

    if (idempLock?.record?._id) {
      await IdempotencyService.completeLock(idempLock.record._id, responsePayload);
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (idempLock?.record?._id) {
      await IdempotencyService.failLock(idempLock.record._id, err);
    }
    if (err.name === 'VersionError' || err.code === 112 || err.hasErrorLabel?.('TransientTransactionError') || err.message?.includes('Write conflict') || err.message?.includes('WriteConflict')) {
      return res.status(409).json({ message: 'Concurrent modification conflict. Please retry.' });
    }
    next(err);
  }
});

// ── 6. GET / (List Overrides) ──────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { status, taskType, warehouse, reasonCode, page = 1, limit = 20 } = req.query;
    const query = { company: req.user.company };

    if (status && status !== 'all') query.status = status.toUpperCase();
    if (taskType && taskType !== 'all') query.taskType = taskType.toLowerCase();
    if (reasonCode) query.reasonCode = reasonCode;

    if (req.context?.warehouse?.code) {
      query.warehouse = req.context.warehouse.code.toUpperCase();
    } else if (warehouse) {
      query.warehouse = warehouse.toUpperCase();
    }

    const p = Math.max(1, parseInt(page, 10));
    const l = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (p - 1) * l;

    const [total, data] = await Promise.all([
      LocationOverride.countDocuments(query),
      LocationOverride.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l)
        .populate('requestedBy', 'name email role')
        .populate('authorizedBy', 'name email role')
    ]);

    res.json({
      data,
      pagination: {
        total,
        page: p,
        limit: l,
        pages: Math.ceil(total / l) || 1
      }
    });
  } catch (err) { next(err); }
});

// ── 7. GET /:id (Get Override Details) ──────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const override = await LocationOverride.findOne({
      _id: req.params.id,
      company: req.user.company
    })
      .populate('requestedBy', 'name email role')
      .populate('authorizedBy', 'name email role');

    if (!override) {
      return res.status(404).json({ message: 'Location override record not found.' });
    }

    res.json(override);
  } catch (err) { next(err); }
});

export default router;
