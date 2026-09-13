import mongoose from 'mongoose';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';
import PickTask from '../models/PickTask.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import AuditLog from '../models/AuditLog.js';
import ActivityLog from '../models/ActivityLog.js';
import { IdempotencyService } from './IdempotencyService.js';

/**
 * Service: Lot Recall Atomic Quarantine Remediation (Stage 5A)
 *
 * Implements the frozen physical inventory rules:
 * - InventoryBalance.qtyAvailable -= Q
 * - InventoryBalance.qtyQuarantine += Q
 * - Product.qty_available -= Q
 * - InventoryTransaction (type = 'QUARANTINE_HOLD')
 * - Pending PickTasks blocked
 * - Immutable AuditLog record created
 * - Zero financial valuation mutations (InventoryCost, InventoryValuationLedger, JournalEntry unchanged)
 * - Atomic Multi-Document Transaction with rollback
 * - Concurrency protection via row-level atomic decrement guards
 */
export const lotRecallService = {
  /**
   * Execute atomic lot recall within a MongoDB session transaction.
   *
   * @param {Object} params
   * @param {ObjectId|String} params.companyId - Required tenant partition
   * @param {String} params.lotNumber - Required lot to recall
   * @param {String} [params.sku] - Optional SKU constraint
   * @param {String} [params.warehouse] - Optional facility constraint
   * @param {String} [params.owner] - Optional owner constraint
   * @param {Number} [params.quantity] - Optional partial quantity to quarantine
   * @param {String} [params.reason] - Reason for recall
   * @param {String} [params.recallId] - Business identifier for recall
   * @param {Object} [params.user] - User object executing recall
   * @param {ClientSession} [params.session] - Optional external session
   */
  async executeLotRecall({
    companyId,
    lotNumber,
    sku,
    warehouse,
    owner,
    quantity,
    reason,
    recallId,
    user,
    session: externalSession = null
  }) {
    const startTime = Date.now();

    if (!companyId) {
      const err = new Error('Company context is required for lot recall');
      err.status = 400;
      throw err;
    }

    if (!lotNumber || typeof lotNumber !== 'string' || !lotNumber.trim()) {
      const err = new Error('lotNumber is required for recall');
      err.status = 400;
      throw err;
    }

    const cleanLotNumber = lotNumber.trim();
    const cleanRecallId = (recallId && typeof recallId === 'string' && recallId.trim())
      ? recallId.trim()
      : 'RCL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

    const isPartial = quantity !== undefined && quantity !== null;
    const requestedQty = isPartial ? Number(quantity) : null;

    if (isPartial && (isNaN(requestedQty) || requestedQty <= 0)) {
      const err = new Error('Recall quantity must be a positive number');
      err.status = 400;
      throw err;
    }

    const runInSession = async (session) => {
      // 1. Discover all candidate balances holding available stock of the recalled lot
      const balQuery = {
        company: companyId,
        lotNumber: cleanLotNumber,
        qtyAvailable: { $gt: 0 }
      };
      if (sku) balQuery.sku = sku;
      if (warehouse) balQuery.warehouse = warehouse;
      if (owner) balQuery.owner = owner;

      const candidateBalances = await InventoryBalance.find(balQuery).session(session);

      const totalAvail = candidateBalances.reduce((sum, b) => sum + (b.qtyAvailable || 0), 0);

      if (candidateBalances.length === 0 || totalAvail === 0) {
        // If there's no available stock, check if lot exists at all or is already quarantined
        const existingLotCount = await InventoryBalance.countDocuments({
          company: companyId,
          lotNumber: cleanLotNumber,
          ...(sku && { sku }),
          ...(warehouse && { warehouse }),
          ...(owner && { owner })
        }).session(session);

        // Block any pending pick tasks referencing this lot even if 0 available stock remaining
        const pickResult = await PickTask.updateMany(
          { company: companyId, status: 'pending', 'items.lotNumber': cleanLotNumber },
          { $set: { status: 'blocked', blockReason: `Lot ${cleanLotNumber} Recalled (${cleanRecallId}): ${reason || 'Quality Hazard / Recall Event'}` } },
          { session }
        );

        return {
          success: true,
          lotNumber: cleanLotNumber,
          recallId: cleanRecallId,
          balancesQuarantined: 0,
          balancesBlocked: 0,
          totalQuantityQuarantined: 0,
          totalAvailablePrior: 0,
          pickTasksBlocked: pickResult.modifiedCount || 0,
          quarantinedRecords: [],
          durationMs: Date.now() - startTime,
          message: existingLotCount > 0
            ? `Lot ${cleanLotNumber} has 0 available units (already quarantined or reserved). Pick tasks blocked.`
            : `Lot ${cleanLotNumber} not found in active inventory. Pick tasks blocked.`
        };
      }

      // Safety check: Cannot recall more than available when specific quantity is requested
      if (isPartial && requestedQty > totalAvail) {
        const err = new Error(`Cannot recall ${requestedQty} units: only ${totalAvail} units currently available for lot ${cleanLotNumber}`);
        err.status = 400;
        throw err;
      }

      let remainingToQuarantine = isPartial ? requestedQty : totalAvail;
      let totalQuarantined = 0;
      const quarantinedRecords = [];
      const skuDeltas = {};

      // 2. Perform atomic row-level shifts from qtyAvailable -> qtyQuarantine
      for (const bal of candidateBalances) {
        if (remainingToQuarantine <= 0) break;
        const canTake = Math.min(bal.qtyAvailable, remainingToQuarantine);
        if (canTake <= 0) continue;

        const updatedBal = await InventoryBalance.findOneAndUpdate(
          {
            _id: bal._id,
            qtyAvailable: { $gte: canTake } // Row-level concurrency guard
          },
          {
            $inc: {
              qtyAvailable: -canTake,
              qtyQuarantine: canTake
            }
          },
          { session, new: true }
        );

        if (!updatedBal) {
          throw new Error(`Concurrent modification detected on inventory balance ${bal._id}. Recall aborted.`);
        }

        remainingToQuarantine -= canTake;
        totalQuarantined += canTake;
        skuDeltas[bal.sku] = (skuDeltas[bal.sku] || 0) + canTake;

        quarantinedRecords.push({
          balanceId: bal._id,
          sku: bal.sku,
          owner: bal.owner,
          ownerType: bal.ownerType || 'UNKNOWN',
          warehouse: bal.warehouse,
          zone: bal.zone,
          aisle: bal.aisle,
          rack: bal.rack,
          bin: bal.bin,
          lotNumber: bal.lotNumber,
          batchNumber: bal.batchNumber || '',
          expiryDate: bal.expiryDate || null,
          quarantinedQty: canTake
        });
      }

      // 3. Atomically update Product.qty_available aggregate exactly once per SKU
      for (const [prodSku, deltaQty] of Object.entries(skuDeltas)) {
        const updatedProd = await Product.findOneAndUpdate(
          {
            company: companyId,
            sku: prodSku,
            qty_available: { $gte: deltaQty } // Aggregate underflow guard
          },
          {
            $inc: { qty_available: -deltaQty }
          },
          { session, new: true }
        );

        if (!updatedProd) {
          throw new Error(`Product aggregate invariant violation: SKU ${prodSku} has insufficient qty_available to quarantine ${deltaQty} units.`);
        }
      }

      // 4. Create immutable InventoryTransaction records of type 'QUARANTINE_HOLD'
      const txnsToCreate = quarantinedRecords.map(rec => ({
        transactionId: 'TXN-REC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'QUARANTINE_HOLD',
        sku: rec.sku,
        owner: rec.owner,
        ownerType: rec.ownerType,
        warehouse: rec.warehouse,
        zone: rec.zone || 'Z-QUARANTINE',
        aisle: rec.aisle || 'A-1',
        rack: rec.rack || 'R-1',
        bin: rec.bin,
        qty: rec.quarantinedQty,
        lotNumber: rec.lotNumber,
        batchNumber: rec.batchNumber,
        expiryDate: rec.expiryDate,
        referenceId: cleanRecallId,
        user: user?.name || user?.email || 'system',
        timestamp: new Date(),
        company: companyId
      }));

      if (txnsToCreate.length > 0) {
        await InventoryTransaction.create(txnsToCreate, { session });
      }

      // 5. Suspend / block pending pick tasks referencing the recalled lot
      const pickResult = await PickTask.updateMany(
        { company: companyId, status: 'pending', 'items.lotNumber': cleanLotNumber },
        { $set: { status: 'blocked', blockReason: `Lot ${cleanLotNumber} Recalled (${cleanRecallId}): ${reason || 'Quality Hazard / Recall Event'}` } },
        { session }
      );

      // 6. Record immutable AuditLog event
      await AuditLog.create([{
        event_id: 'EVT-REC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        timestamp: new Date(),
        event_type: 'lot_recalled',
        user_id: user?._id || undefined,
        user_name: user?.name || 'System Admin',
        lot_number: cleanLotNumber,
        quantity: totalQuarantined,
        reference_id: cleanRecallId,
        reason_text: reason || 'Quality Hazard / Recall Event',
        company: companyId
      }], { session });

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        lotNumber: cleanLotNumber,
        recallId: cleanRecallId,
        balancesQuarantined: quarantinedRecords.length,
        balancesBlocked: quarantinedRecords.length, // legacy alias preserved
        totalQuantityQuarantined: totalQuarantined,
        totalAvailablePrior: totalAvail,
        pickTasksBlocked: pickResult.modifiedCount || 0,
        quarantinedRecords,
        durationMs,
        message: `Atomic Lot Recall completed cleanly in ${durationMs}ms. ${totalQuarantined} units quarantined.`
      };
    };

    // Execute with transaction management
    if (externalSession) {
      return await runInSession(externalSession);
    }

    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await runInSession(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  },

  /**
   * Execute lot recall with distributed idempotency protection.
   */
  async executeIdempotentLotRecall(params) {
    const { companyId, lotNumber, sku, warehouse, owner, quantity, recallId, idempotencyKey } = params;
    
    // Determine stable idempotency identity
    const key = idempotencyKey || recallId || `RECALL-${lotNumber}-${sku || 'ALL'}-${warehouse || 'ALL'}-${owner || 'ALL'}-${quantity || 'ALL'}`;
    const payload = { lotNumber, sku, warehouse, owner, quantity, recallId };

    const lock = await IdempotencyService.acquireLock(
      companyId,
      'LOT_RECALL',
      key,
      payload,
      45000 // 45 second lease
    );

    if (lock.status === 'CACHED') {
      return lock.response;
    }

    try {
      const result = await this.executeLotRecall({
        ...params,
        recallId: params.recallId || key
      });

      await IdempotencyService.completeLock(lock.record._id, result);

      // Async log ActivityLog for UI notifications
      try {
        await ActivityLog.create({
          logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          action: 'LOT_RECALL_EXECUTED',
          module: 'Inventory',
          user: params.user?.name || 'System Admin',
          userId: params.user?._id,
          company: companyId,
          details: `Atomic Lot Recall: Lot #${lotNumber}, ${result.totalQuantityQuarantined} units quarantined, ${result.pickTasksBlocked} pick tasks suspended.`
        });
      } catch (logErr) {
        // Non-fatal UI log
      }

      return result;
    } catch (err) {
      await IdempotencyService.failLock(lock.record._id, err);
      throw err;
    }
  }
};
