import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Model from '../models/Transfer.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import PickTask from '../models/PickTask.js';
import PutawayTask from '../models/PutawayTask.js';
import Counter from '../models/Counter.js';
import IdempotencyRecord from '../models/IdempotencyRecord.js';

const router = express.Router();
router.use(protect);

const requireOpsRole = requireRole('admin', 'manager');

async function nextTaskNumber(prefix, company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counterId = prefix.toLowerCase() === 'put' ? 'putaway' : prefix.toLowerCase();
  const counter = await Counter.findOneAndUpdate(
    { _id: counterId, company },
    { $inc: { seq: 1 } },
    opts
  );
  return `${prefix}-${String(counter.seq).padStart(6, '0')}`;
}

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['transferId', 'product', 'sku'],
      exact: { status: 'status', type: 'type' },
    });
    const result = await paginateQuery(Model, filter, req);
    res.json(result);
  } catch (err) { next(err); }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// CREATE
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const data = { ...req.body, company: req.user.company };
    const item = await Model.create(data);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// UPDATE
router.put('/:id', requireOpsRole, async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey) {
    const existingReq = await IdempotencyRecord.findOne({ idempotencyKey, company: req.user.company });
    if (existingReq) return res.json(existingReq.responsePayload);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!existing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Not found' });
    }

    const wasCompleted = existing.status === 'completed';
    const isCompleted = req.body.status === 'completed';
    const wasProcessing = existing.status === 'processing';
    const isProcessing = req.body.status === 'processing';

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true, session }
    );

    const fromWh = item.from_wh || 'MIA';
    const toWh = item.to_wh || 'MIA';
    const fromLoc = item.from_loc || 'UNKNOWN';
    const toLoc = item.to_loc || 'UNKNOWN';
    const qty = item.qty || 0;
    const sku = item.sku;
    
    // Determine Owner (Assume default if not provided)
    const owner = item.owner || 'Default Owner';

    // 1. INTRA-WAREHOUSE BIN-TO-BIN TRANSFER (Instant Physical Move)
    if (fromWh === toWh) {
      if (!wasCompleted && isCompleted && qty > 0) {
        // Atomic ledger swap
        console.log(`[DEBUG] Transfer PUT Intra-Wh: fromWh=${fromWh}, sku=${sku}, fromLoc=${fromLoc}, owner=${owner}`);
        const sourceBal = await InventoryBalance.findOne({ company: req.user.company, warehouse: fromWh, sku, bin: fromLoc, owner }).session(session);
        if (!sourceBal || sourceBal.qtyAvailable < qty) {
          throw new Error(`Insufficient available stock in ${fromLoc} for SKU ${sku}. Available: ${sourceBal ? sourceBal.qtyAvailable : 0}, Required: ${qty}.`);
        }
        
        const transferOwnerType = sourceBal.ownerType || 'UNKNOWN';

        sourceBal.qtyAvailable -= qty;
        await sourceBal.save({ session });

        await InventoryBalance.findOneAndUpdate(
          { company: req.user.company, warehouse: toWh, sku, bin: toLoc, owner, ownerType: transferOwnerType, lotNumber: 'DEFAULT-LOT' },
          { $inc: { qtyAvailable: qty } },
          { upsert: true, new: true, session }
        );

        // Record transactions
        await InventoryTransaction.create([{
          transactionId: 'TXN-' + Date.now() + '-A', type: 'TRANSFER_OUT', sku, owner, ownerType: transferOwnerType, warehouse: fromWh, bin: fromLoc, qty, referenceId: item.transferId, user: req.user?.name || 'system', company: req.user.company
        }], { session });
        await InventoryTransaction.create([{
          transactionId: 'TXN-' + Date.now() + '-B', type: 'TRANSFER_IN', sku, owner, ownerType: transferOwnerType, warehouse: toWh, bin: toLoc, qty, referenceId: item.transferId, user: req.user?.name || 'system', company: req.user.company
        }], { session });

        // Phase 6 Invariant: If total qtyAvailable remains unchanged, Product.qty_available must remain unchanged.
        // (Since -qty and +qty happen in the same warehouse, Product.qty_available does not change at all!)
      }
    } 
    // 2. INTER-WAREHOUSE TRANSFER
    else {
      if (!wasProcessing && isProcessing && qty > 0) {
        
        const sourceBal = await InventoryBalance.findOne({ company: req.user.company, warehouse: fromWh, sku, bin: fromLoc, owner }).session(session);
        const transferOwnerType = sourceBal ? sourceBal.ownerType : 'UNKNOWN';

        // Origin PickTask -> InTransit -> Destination PutawayTask
        // 1. Create PickTask in origin warehouse
        const pickId = await nextTaskNumber('PICK', req.user.company, session);
        await PickTask.create([{
          taskId: pickId,
          orderId: item.transferId,
          orderNumber: item.transferId,
          orderType: 'TRANSFER',
          owner: owner,
          warehouse: fromWh,
          priority: 'normal',
          status: 'pending',
          company: req.user.company,
          linesCount: 1,
          totalOrderedQty: qty,
          items: [{
            sku,
            productName: item.product || sku,
            orderedQty: qty,
            sourceLocation: fromLoc,
            inventoryOwner: owner,
            ownerType: transferOwnerType,
            status: 'pending'
          }]
        }], { session });

        // 2. Create PutawayTask in destination warehouse (pending InTransit receipt)
        // Wait! A PutawayTask is typically generated when ASN arrives.
        // For inter-warehouse, we can generate it now as 'pending'
        const putawayId = await nextTaskNumber('PUT', req.user.company, session);
        await PutawayTask.create([{
          taskId: putawayId,
          asnId: item.transferId,
          asnNumber: item.transferId,
          supplier: 'Internal Transfer',
          owner,
          ownerType: transferOwnerType,
          sku,
          productName: item.product || sku,
          warehouse: toWh,
          qty,
          lotNumber: 'DEFAULT-LOT',
          fromLocation: 'IN-TRANSIT',
          toLocation: toLoc,
          destinationBin: toLoc,
          priority: 'normal',
          status: 'pending',
          company: req.user.company
        }], { session });

        // 3. Mark transfer as 'processing' (meaning tasks generated)
      }
    }

    if (idempotencyKey) {
      await IdempotencyRecord.create([{
        idempotencyKey: idempotencyKey,
        operation: 'UPDATE_TRANSFER',
        status: 'completed',
        responsePayload: item,
        responseStatus: 200,
        company: req.user.company,
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();
    res.json(item);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// DELETE
router.delete('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) { next(err); }
});

export default router;
