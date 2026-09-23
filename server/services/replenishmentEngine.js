import mongoose from 'mongoose';
import Location from '../models/Location.js';
import Warehouse from '../models/Warehouse.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import WarehouseTask from '../models/WarehouseTask.js';
import Counter from '../models/Counter.js';
import IdempotencyRecord from '../models/IdempotencyRecord.js';
import { resolveDefaultLevelLimit, calculateLocationActiveWeight, getSiblingLocationsOnLevel } from './putawayEngine.js';

/**
 * Service: Replenishment Engine (Stage 7)
 *
 * Implements authoritative replenishment and pick-face replenishment semantics:
 * - Two-phase movement: Reserve (PALLET/RESERVE) -> Complete (PICK_FACE).
 * - Preservation of the global inventory invariant:
 *     Product.qty_available = SUM(InventoryBalance.qtyAvailable).
 * - Concurrency protection using atomic MongoDB conditional updates ($gte).
 * - Strict owner, ownerType, lot, and warehouse isolation.
 * - Anti-overfill awareness: qtyAwaitingPutaway counts toward effective stock.
 * - Idempotent reservation and cancellation (zero double deductions or double releases).
 * - Zero accounting impact (no JournalEntry, no InventoryCost mutation).
 */
export const replenishmentEngine = {
  /**
   * Helper: Resolve warehouse identifier (supports ObjectId or warehouse code)
   */
  async resolveWarehouse(companyObjectId, warehouseInput, session = null) {
    if (!warehouseInput) return { id: null, code: 'MIA' };
    const query = { company: companyObjectId };
    if (mongoose.Types.ObjectId.isValid(warehouseInput) && String(warehouseInput).length === 24) {
      query._id = warehouseInput;
    } else {
      query.code = warehouseInput;
    }
    const wh = await Warehouse.findOne(query).session(session || null);
    if (wh) {
      return { id: wh._id, code: wh.code };
    }
    const fallbackWh = await Warehouse.findOne(
      mongoose.Types.ObjectId.isValid(warehouseInput) && String(warehouseInput).length === 24
        ? { _id: warehouseInput }
        : { code: warehouseInput }
    ).session(session || null);
    if (fallbackWh) {
      return { id: fallbackWh._id, code: fallbackWh.code };
    }
    return {
      id: mongoose.Types.ObjectId.isValid(warehouseInput) && String(warehouseInput).length === 24 ? warehouseInput : null,
      code: String(warehouseInput)
    };
  },

  /**
   * Helper: Generate next unique Replenishment Task Number
   */
  async nextTaskNumber(company, session = null) {
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
    if (session) opts.session = session;
    const counterId = `replenishment_task_${company}`;
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId, company },
      { $inc: { seq: 1 } },
      opts
    );
    return `REP-${String(counter.seq).padStart(6, '0')}`;
  },

  /**
   * Evaluates all active pick faces in a warehouse to identify replenishment needs.
   *
   * @param {ObjectId|String} companyId
   * @param {String} warehouse
   * @param {Object} [options={}] - { dryRun: Boolean }
   * @returns {Promise<Object>} Evaluation results
   */
  async evaluateWarehouse(companyId, warehouse, options = {}) {
    const companyObjectId = typeof companyId === 'string' ? new mongoose.Types.ObjectId(companyId) : companyId;
    const resolvedWh = await this.resolveWarehouse(companyObjectId, warehouse);
    const locWhFilter = resolvedWh.id;
    const balWh = resolvedWh.code;

    // 1. Find all active pick faces with configured min_stock
    const pickFaceQuery = {
      company: companyObjectId,
      $or: [
        { is_pick_face: true },
        { locationType: { $in: ['PICK_FACE', 'pick_face'] } },
        { type: { $in: ['PICK_FACE', 'pick_face'] } }
      ],
      active: { $ne: false },
      status: { $nin: ['BLOCKED', 'MAINTENANCE', 'LOCKED'] },
      min_stock: { $gt: 0 }
    };
    if (locWhFilter) pickFaceQuery.warehouse = locWhFilter;

    const pickFaces = await Location.find(pickFaceQuery);

    const evaluations = [];

    for (const pf of pickFaces) {
      // Find current balances at this pick face
      const balances = await InventoryBalance.find({
        company: companyObjectId,
        warehouse: balWh,
        bin: pf.code
      });

      // Group by SKU
      const skuMap = new Map();
      for (const b of balances) {
        if (!skuMap.has(b.sku)) {
          skuMap.set(b.sku, {
            sku: b.sku,
            owner: b.owner,
            ownerType: b.ownerType || 'COMPANY',
            qtyAvailable: 0,
            qtyReserved: 0,
            qtyAwaitingPutaway: 0,
            lots: []
          });
        }
        const item = skuMap.get(b.sku);
        item.qtyAvailable += b.qtyAvailable || 0;
        item.qtyReserved += b.qtyReserved || 0;
        item.qtyAwaitingPutaway += b.qtyAwaitingPutaway || 0;
        if (b.lotNumber) item.lots.push(b.lotNumber);
      }

      // If pick face is currently empty, check if it's assigned to specific SKU
      if (skuMap.size === 0 && pf.allowed_categories?.length) {
        // Can be replenished if caller provides SKU
      }

      for (const [sku, stock] of skuMap.entries()) {
        const effectiveStock = stock.qtyAvailable + stock.qtyAwaitingPutaway;
        const minStock = pf.min_stock;
        const maxStock = pf.max_stock && pf.max_stock >= minStock ? pf.max_stock : minStock;

        if (effectiveStock < minStock) {
          const requiredQty = maxStock - effectiveStock;

          // Find candidate source storage balances (reserve/pallet locations)
          const sourceBalances = await InventoryBalance.find({
            company: companyObjectId,
            warehouse: balWh,
            sku,
            owner: stock.owner,
            bin: { $ne: pf.code },
            qtyAvailable: { $gt: 0 }
          });

          // Filter out source bins that are themselves pick faces
          const reserveCandidates = [];
          for (const sb of sourceBalances) {
            const locDoc = await Location.findOne({ company: companyObjectId, warehouse: locWhFilter, code: sb.bin });
            if (locDoc && !locDoc.is_pick_face && !['PICK_FACE', 'pick_face'].includes(locDoc.locationType)) {
              // Verify not expired if expiryDate exists
              if (!sb.expiryDate || new Date(sb.expiryDate) > new Date()) {
                reserveCandidates.push({
                  balanceId: sb._id,
                  bin: sb.bin,
                  lotNumber: sb.lotNumber,
                  expiryDate: sb.expiryDate,
                  qtyAvailable: sb.qtyAvailable,
                  owner: sb.owner,
                  ownerType: sb.ownerType
                });
              }
            }
          }

          // Sort candidates FEFO (oldest expiry first), then highest quantity
          reserveCandidates.sort((b_a, b_b) => {
            if (b_a.expiryDate && b_b.expiryDate) {
              const diff = new Date(b_a.expiryDate) - new Date(b_b.expiryDate);
              if (diff !== 0) return diff;
            } else if (b_a.expiryDate) return -1;
            else if (b_b.expiryDate) return 1;
            return b_b.qtyAvailable - b_a.qtyAvailable;
          });

          const totalReserveAvailable = reserveCandidates.reduce((sum, c) => sum + c.qtyAvailable, 0);

          evaluations.push({
            pickFaceBin: pf.code,
            pickFaceId: pf._id,
            sku,
            owner: stock.owner,
            ownerType: stock.ownerType,
            currentAvailable: stock.qtyAvailable,
            awaitingPutaway: stock.qtyAwaitingPutaway,
            effectiveStock,
            minStock,
            maxStock,
            requiredQty,
            totalReserveAvailable,
            hasSufficientStock: totalReserveAvailable >= requiredQty,
            candidates: reserveCandidates
          });
        }
      }
    }

    return {
      warehouse: balWh,
      pickFacesEvaluated: pickFaces.length,
      replenishmentNeededCount: evaluations.length,
      evaluations
    };
  },

  /**
   * Executes atomic reservation of replenishment quantity from source storage to destination pick face.
   *
   * @param {ObjectId|String} companyId
   * @param {Object} params - { warehouse, sku, destinationBin, sourceBin, lotNumber, requestedQty, allowPartial, user, idempotencyKey }
   * @param {ClientSession} [externalSession=null]
   * @returns {Promise<Object>} Created task and reservation details
   */
  async reserveReplenishment(companyId, params, externalSession = null) {
    const {
      warehouse,
      sku,
      destinationBin,
      sourceBin: requestedSourceBin,
      lotNumber: requestedLot,
      requestedQty,
      allowPartial = true,
      user = 'system',
      idempotencyKey
    } = params;

    const companyObjectId = typeof companyId === 'string' ? new mongoose.Types.ObjectId(companyId) : companyId;

    if (!warehouse || !sku || !destinationBin) {
      throw new Error('warehouse, sku, and destinationBin are required.');
    }

    // Idempotency check
    if (idempotencyKey) {
      const existingIdemp = await IdempotencyRecord.findOne({ company: companyObjectId, idempotencyKey });
      if (existingIdemp) {
        // Return existing result
        return existingIdemp.responsePayload;
      }
    }

    const session = externalSession || await mongoose.startSession();
    const ownsSession = !externalSession;
    if (ownsSession) session.startTransaction();

    try {
      const resolvedWh = await this.resolveWarehouse(companyObjectId, warehouse, session);
      const locWhFilter = resolvedWh.id;
      const balWh = resolvedWh.code;

      // 1. Fetch Destination Pick Face
      const destLocQuery = {
        company: companyObjectId,
        code: destinationBin
      };
      if (locWhFilter) destLocQuery.warehouse = locWhFilter;
      const destLoc = await Location.findOne(destLocQuery).session(session);

      if (!destLoc) {
        throw new Error(`Destination location '${destinationBin}' not found in warehouse '${warehouse}'.`);
      }
      if (destLoc.active === false || ['BLOCKED', 'MAINTENANCE', 'LOCKED'].includes(destLoc.status)) {
        throw new Error(`Destination location '${destinationBin}' is inactive or blocked.`);
      }

      const isPickFace = destLoc.is_pick_face || ['PICK_FACE', 'pick_face'].includes(destLoc.locationType) || ['PICK_FACE', 'pick_face'].includes(destLoc.type);
      if (!isPickFace) {
        throw new Error(`Destination location '${destinationBin}' is not a designated PICK_FACE.`);
      }

      // 2. Fetch Product
      const product = await Product.findOne({ company: companyObjectId, sku }).session(session);
      if (!product) {
        throw new Error(`Product with SKU '${sku}' not found.`);
      }

      // 3. Determine Required Quantity if not explicitly supplied
      let Q = requestedQty;
      if (Q === undefined || Q === null) {
        const destBalances = await InventoryBalance.find({
          company: companyObjectId,
          warehouse: balWh,
          bin: destinationBin,
          sku
        }).session(session);

        const currentAvail = destBalances.reduce((sum, b) => sum + (b.qtyAvailable || 0), 0);
        const currentAwaiting = destBalances.reduce((sum, b) => sum + (b.qtyAwaitingPutaway || 0), 0);
        const effective = currentAvail + currentAwaiting;

        const minStock = destLoc.min_stock || 0;
        const maxStock = destLoc.max_stock && destLoc.max_stock >= minStock ? destLoc.max_stock : minStock;

        if (effective >= minStock && minStock > 0) {
          throw new Error(`Pick face '${destinationBin}' stock (${effective}) is already at or above minimum (${minStock}). No replenishment needed.`);
        }
        Q = maxStock - effective;
      }

      if (Q <= 0) {
        throw new Error(`Replenishment quantity must be greater than zero. Evaluated Q: ${Q}`);
      }

      // 4. Find Source Balance Candidate
      const sourceQuery = {
        company: companyObjectId,
        warehouse: balWh,
        sku,
        bin: requestedSourceBin ? requestedSourceBin : { $ne: destinationBin },
        qtyAvailable: { $gt: 0 }
      };
      if (requestedLot) {
        sourceQuery.lotNumber = requestedLot;
      }

      const sourceBalances = await InventoryBalance.find(sourceQuery).session(session);
      if (sourceBalances.length === 0) {
        throw new Error(`No available reserve inventory found for SKU '${sku}' in warehouse '${warehouse}'.`);
      }

      // Filter out source bins that are pick faces
      const eligibleSources = [];
      for (const sb of sourceBalances) {
        const sourceLocQuery = { company: companyObjectId, code: sb.bin };
        if (locWhFilter) sourceLocQuery.warehouse = locWhFilter;
        const loc = await Location.findOne(sourceLocQuery).session(session);
        if (loc && !loc.is_pick_face && !['PICK_FACE', 'pick_face'].includes(loc.locationType) && loc.active !== false) {
          if (!sb.expiryDate || new Date(sb.expiryDate) > new Date()) {
            eligibleSources.push({ balance: sb, location: loc });
          }
        }
      }

      if (eligibleSources.length === 0) {
        throw new Error(`No eligible non-expired reserve storage locations found for SKU '${sku}'.`);
      }

      // Sort FEFO (oldest expiry first)
      eligibleSources.sort((a, b) => {
        const expA = a.balance.expiryDate;
        const expB = b.balance.expiryDate;
        if (expA && expB) {
          const diff = new Date(expA) - new Date(expB);
          if (diff !== 0) return diff;
        } else if (expA) return -1;
        else if (expB) return 1;
        return b.balance.qtyAvailable - a.balance.qtyAvailable;
      });

      const selectedSource = eligibleSources[0];
      const sourceBal = selectedSource.balance;
      const sourceLoc = selectedSource.location;

      // 5. Check Partial Quantity
      let actualQty = Q;
      if (sourceBal.qtyAvailable < Q) {
        if (!allowPartial) {
          throw new Error(`Source location '${sourceBal.bin}' only has ${sourceBal.qtyAvailable} available, but ${Q} was requested and partial replenishment is disabled.`);
        }
        actualQty = sourceBal.qtyAvailable;
      }

      // 6. Check Capacity / Weight on Destination Pick Face
      const unitWeight = product.pallet_weight_kg || 1; // default 1 kg per unit if unconfigured
      const addedWeight = actualQty * unitWeight;
      const currentActiveDestWeight = await calculateLocationActiveWeight(companyObjectId, destLoc.code);
      const newDestWeight = (currentActiveDestWeight.currentWeight || 0) + addedWeight;

      if (destLoc.max_weight_kg && destLoc.max_weight_kg > 0 && newDestWeight > destLoc.max_weight_kg) {
        throw new Error(`Replenishment exceeds destination location weight capacity: ${newDestWeight.toFixed(2)} kg > ${destLoc.max_weight_kg} kg.`);
      }

      // 7. Atomic Source Reservation ($inc qtyAvailable: -actualQty, qtyReserved: +actualQty)
      const updatedSourceBal = await InventoryBalance.findOneAndUpdate(
        {
          _id: sourceBal._id,
          company: companyObjectId,
          qtyAvailable: { $gte: actualQty } // Concurrency atomic guard!
        },
        {
          $inc: {
            qtyAvailable: -actualQty,
            qtyReserved: actualQty
          }
        },
        { new: true, session }
      );

      if (!updatedSourceBal) {
        throw new Error(`CONCURRENCY_CONFLICT: Insufficient available quantity at source bin '${sourceBal.bin}'.`);
      }

      // 8. Atomic Product Allocatable Aggregate Decrement (Product.qty_available -= actualQty)
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: product._id,
          company: companyObjectId,
          qty_available: { $gte: actualQty } // Concurrency atomic guard!
        },
        {
          $inc: {
            qty_available: -actualQty
          }
        },
        { new: true, session }
      );

      if (!updatedProduct) {
        throw new Error(`CONCURRENCY_CONFLICT: Insufficient allocatable stock in product catalog for SKU '${sku}'.`);
      }

      // 9. Increment Destination qtyAwaitingPutaway
      await InventoryBalance.findOneAndUpdate(
        {
          company: companyObjectId,
          warehouse,
          sku,
          bin: destinationBin,
          owner: sourceBal.owner,
          lotNumber: sourceBal.lotNumber || 'DEFAULT-LOT'
        },
        {
          $inc: {
            qtyAwaitingPutaway: actualQty
          },
          $min: {
            entryDate: updatedSourceBal.entryDate || new Date()
          },
          $setOnInsert: {
            ownerType: sourceBal.ownerType || 'COMPANY',
            qtyAvailable: 0,
            qtyReserved: 0,
            qtyQuarantine: 0,
            expiryDate: sourceBal.expiryDate || null
          }
        },
        { upsert: true, new: true, session }
      );

      // 10. Generate Task Number & Record WarehouseTask
      const taskNumber = await this.nextTaskNumber(companyObjectId, session);
      const [task] = await WarehouseTask.create([{
        taskId: taskNumber,
        task_type: 'replenishment',
        status: 'pending',
        priority: 2, // high priority for replenishment
        sku: product._id,
        sku_code: sku,
        lot_number: sourceBal.lotNumber || '',
        qty: actualQty,
        warehouse,
        owner: sourceBal.owner,
        ownerType: sourceBal.ownerType || 'COMPANY',
        source_location: sourceLoc._id,
        source_bin: sourceLoc.code,
        destination_location: destLoc._id,
        destination_bin: destLoc.code,
        zone: destLoc.zone,
        reference_id: taskNumber,
        company: companyObjectId
      }], { session });

      // 11. Record InventoryTransaction
      await InventoryTransaction.create([{
        transactionId: 'TXN-REP-RES-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'REPLENISHMENT_RESERVE',
        sku,
        owner: sourceBal.owner,
        ownerType: sourceBal.ownerType || 'COMPANY',
        warehouse,
        bin: sourceLoc.code,
        qty: actualQty,
        lotNumber: sourceBal.lotNumber || '',
        expiryDate: sourceBal.expiryDate || null,
        referenceId: taskNumber,
        user,
        company: companyObjectId
      }], { session });

      const responsePayload = {
        success: true,
        reservedQty: actualQty,
        task: {
          _id: task._id,
          id: task._id,
          taskId: task.taskId,
          status: task.status,
          qty: actualQty,
          sku,
          lotNumber: sourceBal.lotNumber || '',
          sourceBin: sourceLoc.code,
          destinationBin: destLoc.code,
          warehouse
        },
        source: {
          bin: sourceLoc.code,
          qtyReserved: actualQty,
          remainingAvailable: updatedSourceBal.qtyAvailable
        },
        destination: {
          bin: destLoc.code,
          qtyAwaitingPutaway: actualQty
        },
        productAggregate: {
          sku,
          newQtyAvailable: updatedProduct.qty_available - actualQty
        }
      };

      if (idempotencyKey) {
        await IdempotencyRecord.create([{
          company: companyObjectId,
          warehouse: resolvedWh.id || undefined,
          idempotencyKey,
          operation: 'REPLENISHMENT_RESERVE',
          status: 'completed',
          endpoint: '/inventory/replenishment/reserve',
          requestPayload: params,
          responsePayload,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }], { session });
      }

      if (ownsSession) {
        await session.commitTransaction();
        session.endSession();
      }

      return responsePayload;
    } catch (err) {
      if (ownsSession) {
        await session.abortTransaction();
        session.endSession();
      }
      throw err;
    }
  },

  /**
   * Completes a physical replenishment movement:
   * Moves stock from source.qtyReserved into destination.qtyAvailable, decrements destination.qtyAwaitingPutaway,
   * and restores Product.qty_available.
   *
   * @param {ObjectId|String} companyId
   * @param {String} taskId
   * @param {String} [user='system']
   * @param {ClientSession} [externalSession=null]
   * @returns {Promise<Object>} Completion result
   */
  async completeReplenishment(companyId, taskId, user = 'system', scanVerification = {}, externalSession = null) {
    const companyObjectId = typeof companyId === 'string' ? new mongoose.Types.ObjectId(companyId) : companyId;

    const session = externalSession || await mongoose.startSession();
    const ownsSession = !externalSession;
    if (ownsSession) session.startTransaction();

    try {
      const isObjectId = mongoose.Types.ObjectId.isValid(taskId) && String(taskId).length === 24;
      const task = await WarehouseTask.findOne({
        ...(isObjectId ? { _id: taskId } : { taskId }),
        company: companyObjectId,
        task_type: 'replenishment'
      }).session(session);

      if (!task) {
        throw new Error(`Replenishment task '${taskId}' not found.`);
      }

      if (task.status === 'completed') {
        throw new Error(`Replenishment task '${task.taskId || taskId}' is already completed.`);
      }
      if (task.status === 'cancelled') {
        throw new Error(`Cannot complete cancelled replenishment task '${task.taskId || taskId}'.`);
      }

      const Q = task.qty;
      const sku = task.sku_code;
      const sourceBin = task.source_bin;
      const destBin = task.destination_bin;
      const owner = task.owner;
      const lotNumber = task.lot_number || 'DEFAULT-LOT';
      const warehouse = task.warehouse;

      // Operator Scan Verification (RF-P07)
      if (scanVerification && typeof scanVerification === 'object') {
        if (scanVerification.sourceBin && sourceBin) {
          if (scanVerification.sourceBin.trim().toUpperCase() !== sourceBin.trim().toUpperCase()) {
            throw new Error(`Invalid source location scan: expected '${sourceBin}', got '${scanVerification.sourceBin}'`);
          }
        }
        if (scanVerification.destinationBin && destBin) {
          if (scanVerification.destinationBin.trim().toUpperCase() !== destBin.trim().toUpperCase()) {
            throw new Error(`Invalid destination location scan: expected '${destBin}', got '${scanVerification.destinationBin}'`);
          }
        }
        if (scanVerification.sku && sku) {
          if (scanVerification.sku.trim().toUpperCase() !== sku.trim().toUpperCase()) {
            throw new Error(`Invalid SKU scan: expected '${sku}', got '${scanVerification.sku}'`);
          }
        }
        if (scanVerification.qty !== undefined && scanVerification.qty !== null) {
          if (Number(scanVerification.qty) !== Q) {
            throw new Error(`Invalid quantity: expected ${Q}, got ${scanVerification.qty}`);
          }
        }
      }

      // 1. Decrement source.qtyReserved
      const sourceBal = await InventoryBalance.findOneAndUpdate(
        {
          company: companyObjectId,
          warehouse,
          sku,
          bin: sourceBin,
          owner,
          qtyReserved: { $gte: Q } // Guard against double completion
        },
        {
          $inc: { qtyReserved: -Q }
        },
        { new: true, session }
      );

      if (!sourceBal) {
        throw new Error(`INVARIANT_VIOLATION: Source balance in '${sourceBin}' does not hold required reserved quantity (${Q}).`);
      }

      // 2. Decrement destination.qtyAwaitingPutaway, increment destination.qtyAvailable
      const destBal = await InventoryBalance.findOneAndUpdate(
        {
          company: companyObjectId,
          warehouse,
          sku,
          bin: destBin,
          owner,
          lotNumber,
          qtyAwaitingPutaway: { $gte: Q } // Guard against double completion
        },
        {
          $inc: {
            qtyAwaitingPutaway: -Q,
            qtyAvailable: Q
          }
        },
        { new: true, session }
      );

      if (!destBal) {
        throw new Error(`INVARIANT_VIOLATION: Destination balance in '${destBin}' lacks expected awaiting putaway quantity (${Q}).`);
      }

      // 3. Increment Product.qty_available (restoring the allocatable pool to its previous sum)
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: task.sku,
          company: companyObjectId
        },
        {
          $inc: { qty_available: Q }
        },
        { new: true, session }
      );

      // 4. Update task status & operator traceability (RF-P07)
      task.status = 'completed';
      task.completed_by = user;
      task.completed_at = new Date();
      await task.save({ session });

      // 5. Record InventoryTransaction
      await InventoryTransaction.create([{
        transactionId: 'TXN-REP-CMP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'REPLENISHMENT_COMPLETE',
        sku,
        owner,
        ownerType: task.ownerType || 'COMPANY',
        warehouse,
        bin: destBin,
        qty: Q,
        lotNumber,
        referenceId: task.taskId || String(task._id),
        user,
        company: companyObjectId
      }], { session });

      const result = {
        success: true,
        taskId: task.taskId || String(task._id),
        status: 'completed',
        transferredQty: Q,
        sourceBin,
        destinationBin: destBin,
        destinationAvailable: destBal.qtyAvailable,
        productQtyAvailable: updatedProduct.qty_available
      };

      if (ownsSession) {
        await session.commitTransaction();
        session.endSession();
      }

      return result;
    } catch (err) {
      if (ownsSession) {
        await session.abortTransaction();
        session.endSession();
      }
      throw err;
    }
  },

  /**
   * Cancels a pending replenishment task and restores reserved stock to source available.
   *
   * @param {ObjectId|String} companyId
   * @param {String} taskId
   * @param {String} [user='system']
   * @param {ClientSession} [externalSession=null]
   * @returns {Promise<Object>} Cancellation result
   */
  async cancelReplenishment(companyId, taskId, user = 'system', externalSession = null) {
    const companyObjectId = typeof companyId === 'string' ? new mongoose.Types.ObjectId(companyId) : companyId;

    const session = externalSession || await mongoose.startSession();
    const ownsSession = !externalSession;
    if (ownsSession) session.startTransaction();

    try {
      const task = await WarehouseTask.findOne({
        _id: taskId,
        company: companyObjectId,
        task_type: 'replenishment'
      }).session(session);

      if (!task) {
        throw new Error(`Replenishment task '${taskId}' not found.`);
      }

      // Idempotency: If already cancelled, return cleanly without duplicating restores
      if (task.status === 'cancelled') {
        if (ownsSession) {
          await session.commitTransaction();
          session.endSession();
        }
        return {
          success: true,
          taskId: task.taskId || String(task._id),
          status: 'cancelled',
          alreadyCancelled: true
        };
      }

      if (task.status === 'completed') {
        throw new Error(`Cannot cancel an already completed replenishment task '${task.taskId || taskId}'.`);
      }

      const Q = task.qty;
      const sku = task.sku_code;
      const sourceBin = task.source_bin;
      const destBin = task.destination_bin;
      const owner = task.owner;
      const lotNumber = task.lot_number || 'DEFAULT-LOT';
      const warehouse = task.warehouse;

      // 1. Restore source: qtyAvailable += Q, qtyReserved -= Q
      const updatedSource = await InventoryBalance.findOneAndUpdate(
        {
          company: companyObjectId,
          warehouse,
          sku,
          bin: sourceBin,
          owner,
          qtyReserved: { $gte: Q } // Guard against negative reserved
        },
        {
          $inc: {
            qtyAvailable: Q,
            qtyReserved: -Q
          }
        },
        { new: true, session }
      );

      if (!updatedSource) {
        throw new Error(`INVARIANT_VIOLATION: Cannot restore source reserved quantity in '${sourceBin}'.`);
      }

      // 2. Clear destination qtyAwaitingPutaway
      await InventoryBalance.findOneAndUpdate(
        {
          company: companyObjectId,
          warehouse,
          sku,
          bin: destBin,
          owner,
          lotNumber,
          qtyAwaitingPutaway: { $gte: Q }
        },
        {
          $inc: { qtyAwaitingPutaway: -Q }
        },
        { new: true, session }
      );

      // 3. Restore Product.qty_available += Q
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: task.sku,
          company: companyObjectId
        },
        {
          $inc: { qty_available: Q }
        },
        { new: true, session }
      );

      // 4. Mark task cancelled
      task.status = 'cancelled';
      await task.save({ session });

      // 5. Record InventoryTransaction
      await InventoryTransaction.create([{
        transactionId: 'TXN-REP-CAN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'REPLENISHMENT_CANCEL',
        sku,
        owner,
        ownerType: task.ownerType || 'COMPANY',
        warehouse,
        bin: sourceBin,
        qty: Q,
        lotNumber,
        referenceId: task.taskId || String(task._id),
        user,
        company: companyObjectId
      }], { session });

      const result = {
        success: true,
        taskId: task.taskId || String(task._id),
        status: 'cancelled',
        restoredQty: Q,
        sourceBin,
        destinationBin: destBin,
        sourceAvailable: updatedSource.qtyAvailable,
        productQtyAvailable: updatedProduct.qty_available
      };

      if (ownsSession) {
        await session.commitTransaction();
        session.endSession();
      }

      return result;
    } catch (err) {
      if (ownsSession) {
        await session.abortTransaction();
        session.endSession();
      }
      throw err;
    }
  },

  /**
   * Dry-run replenishment simulator.
   * Evaluates pick faces and simulates proposed movements without committing any database writes.
   *
   * @param {ObjectId|String} companyId
   * @param {String} warehouse
   * @returns {Promise<Object>} Simulated replenishment plan
   */
  async simulateReplenishment(companyId, warehouse) {
    const evalResult = await this.evaluateWarehouse(companyId, warehouse, { dryRun: true });
    return {
      dryRun: true,
      timestamp: new Date(),
      warehouse,
      pickFacesEvaluated: evalResult.pickFacesEvaluated,
      recommendedReplenishments: evalResult.evaluations.map(e => ({
        pickFace: e.pickFaceBin,
        sku: e.sku,
        owner: e.owner,
        effectiveStock: e.effectiveStock,
        minStock: e.minStock,
        maxStock: e.maxStock,
        recommendedQty: e.requiredQty,
        allocatedFrom: e.candidates.length > 0 ? e.candidates[0].bin : null,
        allocatedLot: e.candidates.length > 0 ? e.candidates[0].lotNumber : null,
        feasible: e.hasSufficientStock
      }))
    };
  }
};
