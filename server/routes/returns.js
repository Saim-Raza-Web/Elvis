import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Model from '../models/Return.js';
import Product from '../models/Product.js';
import Incident from '../models/Incident.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import PutawayTask from '../models/PutawayTask.js';
import Counter from '../models/Counter.js';
import IdempotencyRecord from '../models/IdempotencyRecord.js';

const router = express.Router();

router.use(protect); // Secure all routes by default
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

async function nextPutawayNumber(company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: 'putaway', company },
    { $inc: { seq: 1 } },
    opts
  );
  return `PUT-${String(counter.seq).padStart(6, '0')}`;
}

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['returnId', 'order', 'customer'],
    });
    const result = await paginateQuery(Model, filter, req);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const data = { ...req.body, company: req.user.company };
    const item = await Model.create(data);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE (PROCESS RETURN - PHASE 6)
router.put('/:id', requireOpsRole, async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey) {
    const existingReq = await IdempotencyRecord.findOne({ key: idempotencyKey, company: req.user.company });
    if (existingReq) return res.json(existingReq.responseBody);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const warehouse = req.context?.warehouse?.code || 'MIA';

    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!existing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Not found' });
    }

    const wasProcessed = existing.status === 'processed' || existing.status === 'refunded';
    const isProcessed = req.body.status === 'processed' || req.body.status === 'refunded';

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true, session }
    );

    // If newly processed, process items_details for restock vs block
    if (!wasProcessed && isProcessed && item.items_details && item.items_details.length > 0) {
      for (const row of item.items_details) {
        if (row.qc_status === 'restock') {
          const itemOwner = existing.owner || existing.customer || 'Returns Owner';
          const itemOwnerType = existing.ownerType || 'UNKNOWN';

          if (itemOwnerType === 'UNKNOWN') {
            throw new Error(`HARD FAILURE: Return ${existing.returnId} lacks a valid ownerType (COMPANY or CUSTOMER). Cannot inject UNKNOWN stock into warehouse.`);
          }

          // Phase 6 Invariant: Add to qtyAwaitingPutaway in RETURNS-STAGING bin.
          // Do NOT increment Product.qty_available.
          await InventoryBalance.findOneAndUpdate(
            { company: req.user.company, warehouse, sku: row.sku, owner: itemOwner, ownerType: itemOwnerType, bin: 'RETURNS-STAGING', lotNumber: 'DEFAULT-LOT' },
            { $inc: { qtyAwaitingPutaway: row.qty } },
            { upsert: true, new: true, session }
          );

          await InventoryTransaction.create([{
            transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
            type: 'RETURN',
            sku: row.sku,
            owner: itemOwner,
            ownerType: itemOwnerType,
            warehouse,
            bin: 'RETURNS-STAGING',
            qty: row.qty,
            referenceId: item.returnId,
            user: req.user.email || req.user.name || 'system',
            timestamp: new Date(),
            company: req.user.company
          }], { session });

          const putawayId = await nextPutawayNumber(req.user.company, session);
          await PutawayTask.create([{
            taskId: putawayId,
            asnId: item.returnId,
            asnNumber: item.returnId,
            supplier: item.customer,
            owner: itemOwner,
            ownerType: itemOwnerType,
            sku: row.sku,
            productName: row.product || row.sku,
            warehouse,
            qty: row.qty,
            lotNumber: 'DEFAULT-LOT',
            fromLocation: 'RETURNS-STAGING',
            toLocation: 'Z-RECEIVING', // Manager to determine later
            destinationBin: 'Z-RECEIVING',
            priority: 'normal',
            status: 'pending',
            createdBy: req.user.email || req.user.name || 'system',
            company: req.user.company
          }], { session });

        } else if (row.qc_status === 'disposed' || row.qc_status === 'rejected') {
          // Add to blocked stock (Quarantine)
          const itemOwner = existing.owner || existing.customer || 'Returns Owner';
          const itemOwnerType = existing.ownerType || 'UNKNOWN';

          if (itemOwnerType === 'UNKNOWN') {
            throw new Error(`HARD FAILURE: Return ${existing.returnId} lacks a valid ownerType (COMPANY or CUSTOMER). Cannot inject UNKNOWN stock into warehouse.`);
          }

          await InventoryBalance.findOneAndUpdate(
            { company: req.user.company, warehouse, sku: row.sku, owner: itemOwner, ownerType: itemOwnerType, bin: 'QUARANTINE-REJECTS', lotNumber: 'DEFAULT-LOT' },
            { $inc: { qtyQuarantine: row.qty } },
            { upsert: true, new: true, session }
          );

          await InventoryTransaction.create([{
            transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
            type: 'RETURN_REJECT',
            sku: row.sku,
            owner: itemOwner,
            ownerType: itemOwnerType,
            warehouse,
            bin: 'QUARANTINE-REJECTS',
            qty: row.qty,
            referenceId: item.returnId,
            user: req.user.email || req.user.name || 'system',
            timestamp: new Date(),
            company: req.user.company
          }], { session });

          // Create incident
          await Incident.create([{
            incidentId: `INC-RET-${Date.now().toString().slice(-6)}`,
            type: 'Damage',
            sku: row.sku,
            location: 'Returns Zone',
            owner: itemOwner,
            reported_by: req.user.name,
            description: `Return ${item.returnId} items rejected/damaged: ${row.reason}`,
            company: req.user.company
          }], { session });
        }
      }
    } else if (!wasProcessed && isProcessed && (!item.items_details || item.items_details.length === 0) && item.items > 0) {
      // Phase 6: We cannot just magically create stock. Even if legacy, we must put it in staging!
      const product = await Product.findOne({ company: req.user.company }).session(session);
      if (product) {
        const itemOwner = existing.owner || existing.customer || 'Returns Owner';
        const itemOwnerType = existing.ownerType || 'UNKNOWN';

        if (itemOwnerType === 'UNKNOWN') {
          throw new Error(`HARD FAILURE: Legacy Return ${existing.returnId} lacks a valid ownerType (COMPANY or CUSTOMER). Cannot inject UNKNOWN stock into warehouse.`);
        }

        await InventoryBalance.findOneAndUpdate(
          { company: req.user.company, warehouse, sku: product.sku, owner: itemOwner, ownerType: itemOwnerType, bin: 'RETURNS-STAGING', lotNumber: 'DEFAULT-LOT' },
          { $inc: { qtyAwaitingPutaway: item.items } },
          { upsert: true, new: true, session }
        );

        await InventoryTransaction.create([{
          transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          type: 'RETURN',
          sku: product.sku,
          owner: itemOwner,
          ownerType: itemOwnerType,
          warehouse,
          bin: 'RETURNS-STAGING',
          qty: item.items,
          referenceId: item.returnId,
          user: req.user.email || req.user.name || 'system',
          timestamp: new Date(),
          company: req.user.company
        }], { session });

        const putawayId = await nextPutawayNumber(req.user.company, session);
        await PutawayTask.create([{
          taskId: putawayId,
          asnId: item.returnId,
          asnNumber: item.returnId,
          supplier: item.customer,
          owner: itemOwner,
          ownerType: itemOwnerType,
          sku: product.sku,
          productName: product.name,
          warehouse,
          qty: item.items,
          lotNumber: 'DEFAULT-LOT',
          fromLocation: 'RETURNS-STAGING',
          toLocation: 'Z-RECEIVING',
          destinationBin: 'Z-RECEIVING',
          priority: 'normal',
          status: 'pending',
          createdBy: req.user.email || req.user.name || 'system',
          company: req.user.company
        }], { session });
      }
    }

    if (idempotencyKey) {
      await IdempotencyRecord.create([{
        key: idempotencyKey,
        responseBody: item,
        company: req.user.company,
        createdAt: new Date()
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
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
