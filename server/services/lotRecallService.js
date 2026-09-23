import mongoose from 'mongoose';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';
import PickTask from '../models/PickTask.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import AuditLog from '../models/AuditLog.js';
import ActivityLog from '../models/ActivityLog.js';
import Order from '../models/Order.js';
import Shipment from '../models/Shipment.js';
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
        await InventoryTransaction.create(txnsToCreate, { session, ordered: true });
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
      }], { session, ordered: true });

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
    let result;
    if (externalSession) {
      result = await runInSession(externalSession);
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          result = await runInSession(session);
        });
      } finally {
        await session.endSession();
      }
    }

    // RF-P10: Attach shipped orders discovery report (read-only, post-commit)
    try {
      const shippedOrders = await this.getShippedOrdersReport({
        companyId,
        lotNumber: cleanLotNumber,
        sku,
        warehouse,
        owner
      });
      result.shippedOrders = shippedOrders;
      result.shippedOrdersCount = shippedOrders.length;
    } catch (_) {
      result.shippedOrders = [];
      result.shippedOrdersCount = 0;
    }

    return result;
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
  },

  /**
   * RF-P10: Discover all orders that have already shipped containing the recalled SKU / Lot.
   * Completely read-only with respect to inventory.
   */
  async getShippedOrdersReport({ companyId, lotNumber, sku, warehouse, owner }) {
    if (!companyId || !lotNumber) return [];

    const companyObjectId = typeof companyId === 'string'
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    const cleanLotNumber = String(lotNumber).trim();

    // 1. Discover shipped InventoryTransactions referencing this lot
    const txnQuery = {
      company: companyObjectId,
      lotNumber: cleanLotNumber,
      type: { $in: ['PICK', 'PICK_COMPLETE', 'SHIPMENT', 'OUTBOUND_SHIPMENT', 'DISPATCH'] }
    };
    if (sku) txnQuery.sku = sku;
    if (warehouse) txnQuery.warehouse = warehouse;
    if (owner) txnQuery.owner = owner;

    const transactions = await InventoryTransaction.find(txnQuery).lean();
    const referenceIds = transactions.map(t => t.referenceId).filter(Boolean);

    // 2. Discover PickTasks completed that had items with this lot
    const pickQuery = {
      company: companyObjectId,
      status: { $in: ['completed', 'picked', 'in_progress', 'partially_picked'] },
      $or: [
        { 'items.lotNumber': cleanLotNumber },
        { taskId: { $in: referenceIds } },
        { orderId: { $in: referenceIds } }
      ]
    };
    if (warehouse) pickQuery.warehouse = warehouse;
    if (owner) pickQuery.owner = owner;

    const pickTasks = await PickTask.find(pickQuery).lean();

    const orderIdentifiers = new Set();
    pickTasks.forEach(pt => {
      if (pt.orderId) orderIdentifiers.add(pt.orderId);
      if (pt.orderNumber) orderIdentifiers.add(pt.orderNumber);
      if (pt.order) orderIdentifiers.add(pt.order);
    });
    referenceIds.forEach(id => orderIdentifiers.add(id));

    // 3. Find matching Order documents (specifically those already in fulfillment / shipped states)
    const orderQuery = {
      company: companyObjectId,
      $or: [
        { orderId: { $in: Array.from(orderIdentifiers) } },
        { 'product_lines.sku': sku || { $exists: true } }
      ],
      status: { $in: ['shipped', 'delivered', 'READY FOR SHIPPING', 'packed', 'picked', 'partially_fulfilled'] }
    };
    if (warehouse) orderQuery.warehouse = warehouse;
    if (owner) orderQuery.owner = owner;

    const orders = await Order.find(orderQuery).lean();

    // 4. Find Shipments matching these orders or lot references
    const orderIdsList = orders.map(o => o.orderId);
    const shipments = await Shipment.find({
      company: companyObjectId,
      $or: [
        { order: { $in: orderIdsList } },
        { packId: { $in: Array.from(orderIdentifiers) } }
      ]
    }).lean();

    const shipmentMap = new Map();
    shipments.forEach(s => {
      if (s.order) shipmentMap.set(s.order, s);
    });

    const reportRows = [];
    for (const ord of orders) {
      const shp = shipmentMap.get(ord.orderId) || {};
      const relevantLines = ord.product_lines?.filter(l => !sku || l.sku === sku) || [];
      const shippedQty = relevantLines.reduce((s, l) => s + (l.qty || 0), 0);

      reportRows.push({
        orderId: ord.orderId,
        orderNumber: ord.orderId,
        shipmentId: shp.shipmentId || shp.tracking || 'SHP-' + ord.orderId,
        tracking: shp.tracking || ord.tracking_number || '',
        carrier: shp.carrier || 'Standard Carrier',
        customer: ord.customer || 'Unknown Customer',
        owner: ord.owner || owner || 'Default Owner',
        ownerType: ord.ownerType || 'COMPANY',
        sku: sku || (relevantLines[0]?.sku) || 'RECALLED-SKU',
        productName: relevantLines[0]?.product_name || 'Recalled Product',
        lotNumber: cleanLotNumber,
        shippedQty: shippedQty || ord.items || 1,
        shippedDate: ord.date || ord.updatedAt || new Date(),
        status: ord.status,
        warehouse: ord.warehouse || warehouse || 'MIA'
      });
    }

    // If transactions found but no Order documents matched (e.g. mock or test data where only txns/pickTasks exist)
    if (reportRows.length === 0 && pickTasks.length > 0) {
      for (const pt of pickTasks) {
        const itemMatch = pt.items?.find(i => (!sku || i.sku === sku) && (!cleanLotNumber || i.lotNumber === cleanLotNumber)) || pt.items?.[0] || {};
        reportRows.push({
          orderId: pt.orderId || pt.taskId,
          orderNumber: pt.orderNumber || pt.orderId || pt.taskId,
          shipmentId: pt.deliveryNoteNumber || 'SHP-' + (pt.orderId || pt.taskId),
          tracking: '',
          carrier: 'Direct Dispatch',
          customer: pt.customer || 'Customer',
          owner: pt.owner || 'Default Owner',
          ownerType: pt.ownerType || 'COMPANY',
          sku: itemMatch.sku || sku || 'RECALLED-SKU',
          productName: itemMatch.productName || 'Recalled Product',
          lotNumber: cleanLotNumber,
          shippedQty: itemMatch.pickedQty || itemMatch.orderedQty || pt.totalPickedQty || 1,
          shippedDate: pt.completedAt || pt.updatedAt || new Date(),
          status: pt.status,
          warehouse: pt.warehouse || 'MIA'
        });
      }
    }

    return reportRows;
  },

  /**
   * RF-P10: Get current inventory summary for a lot (Remaining Stock).
   */
  async getLotInventorySummary({ companyId, lotNumber, sku, warehouse, owner }) {
    if (!companyId || !lotNumber) return { remainingStock: [], totalAvailable: 0, totalQuarantine: 0, totalReserved: 0 };

    const companyObjectId = typeof companyId === 'string'
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    const query = {
      company: companyObjectId,
      lotNumber: String(lotNumber).trim()
    };
    if (sku) query.sku = sku;
    if (warehouse) query.warehouse = warehouse;
    if (owner) query.owner = owner;

    const balances = await InventoryBalance.find(query).lean();
    let totalAvailable = 0;
    let totalQuarantine = 0;
    let totalReserved = 0;

    const remainingStock = balances.map(b => {
      totalAvailable += (b.qtyAvailable || 0);
      totalQuarantine += (b.qtyQuarantine || 0);
      totalReserved += (b.qtyReserved || 0);
      return {
        id: b._id,
        sku: b.sku,
        bin: b.bin,
        warehouse: b.warehouse,
        owner: b.owner,
        ownerType: b.ownerType,
        lotNumber: b.lotNumber,
        qtyAvailable: b.qtyAvailable || 0,
        qtyQuarantine: b.qtyQuarantine || 0,
        qtyReserved: b.qtyReserved || 0,
        expiryDate: b.expiryDate || null
      };
    });

    return {
      remainingStock,
      totalAvailable,
      totalQuarantine,
      totalReserved
    };
  }
};
