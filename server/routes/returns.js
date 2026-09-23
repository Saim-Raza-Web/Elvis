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
import AuditLog from '../models/AuditLog.js';
import { validateOwnerMaster } from '../utils/ownerValidation.js';

const router = express.Router();

router.use(protect); // Secure all routes by default
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

async function nextPutawayNumber(company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: `putaway_${company}`, company },
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

    // G-01: Validate owner against Client master when ownerType is CUSTOMER
    const ownerTypeToCheck = data.ownerType || 'UNKNOWN';
    if (ownerTypeToCheck === 'CUSTOMER') {
      const ownerError = await validateOwnerMaster(data.owner, ownerTypeToCheck, req.user.company);
      if (ownerError) return res.status(422).json({ message: ownerError });
    }

    const item = await Model.create(data);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE (PROCESS RETURN - PHASE 6 + RF-P11 Decision Engine)
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

    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!existing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Not found' });
    }

    const warehouse = req.body.warehouse || existing.warehouse || req.context?.warehouse?.code || 'MIA';

    const wasProcessed = existing.status === 'processed' || existing.status === 'refunded';
    const isProcessed = req.body.status === 'processed' || req.body.status === 'refunded';

    const ownerToCheck = req.body.owner !== undefined ? req.body.owner : existing.owner;
    const typeToCheck = req.body.ownerType !== undefined ? req.body.ownerType : existing.ownerType;
    
    if (typeToCheck === 'CUSTOMER') {
      const ownerError = await validateOwnerMaster(ownerToCheck, typeToCheck, req.user.company);
      if (ownerError) {
        await session.abortTransaction();
        session.endSession();
        return res.status(422).json({ message: ownerError });
      }
    }

    // RF-P11: Decision Engine Validation
    if (req.body.items_details && Array.isArray(req.body.items_details)) {
      const validDecisions = ['PENDING_DECISION', 'RESTOCK_CLIENT', 'RESTOCK_COMPANY', 'INCIDENT', 'WRITEOFF'];
      
      for (const item of req.body.items_details) {
        if (item.decision && !validDecisions.includes(item.decision)) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: `Invalid decision: ${item.decision}. Valid decisions are: ${validDecisions.join(', ')}` });
        }
        
        // RF-P11: WRITEOFF requires reason
        if (item.decision === 'WRITEOFF' && (!item.decision_reason || !item.decision_reason.trim())) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: 'WRITEOFF decision requires a decision_reason' });
        }
        
        // RF-P11: Check for existing final decision (immutability)
        const existingItem = existing.items_details?.find((existingItemDetail) => 
          existingItemDetail.sku === item.sku
        );
        
        if (existingItem && existingItem.decision && existingItem.decision !== 'PENDING_DECISION') {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ 
            message: `Item ${item.sku} already has a final decision (${existingItem.decision}). Decisions are immutable.` 
          });
        }
        
        // RF-P11: Set decision metadata if decision is being made
        if (item.decision && item.decision !== 'PENDING_DECISION') {
          item.decision_by = item.decision_by || req.user?.name || req.user?.email || 'system';
          item.decision_date = item.decision_date || new Date();
          
          // RF-P11: INCIDENT decision requires incidentId
          if (item.decision === 'INCIDENT' && !item.incidentId) {
            item.incidentId = `INC-RET-${Date.now().toString().slice(-6)}`;
          }
        }
      }
    }

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true, session }
    );

    // If newly processed, process items_details for restock vs block (RF-P11 Decision Engine)
    if (!wasProcessed && isProcessed && item.items_details && item.items_details.length > 0) {
      for (const row of item.items_details) {
        const decision = row.decision || 'PENDING_DECISION';
        const itemOwner = existing.owner || existing.customer || 'Returns Owner';
        const itemOwnerType = existing.ownerType || 'UNKNOWN';

        if (itemOwnerType === 'UNKNOWN') {
          throw new Error(`HARD FAILURE: Return ${existing.returnId} lacks a valid ownerType (COMPANY or CUSTOMER). Cannot inject UNKNOWN stock into warehouse.`);
        }

        // RF-P11: Decision routing
        if (decision === 'RESTOCK_CLIENT' || decision === 'RESTOCK_COMPANY') {
          // For RESTOCK_CLIENT, preserve customer ownership
          // For RESTOCK_COMPANY, ownership becomes COMPANY
          const finalOwner = decision === 'RESTOCK_CLIENT' ? itemOwner : 'Internal Stock';
          const finalOwnerType = decision === 'RESTOCK_CLIENT' ? itemOwnerType : 'COMPANY';

          // Phase 6 Invariant: Add to qtyAwaitingPutaway in RETURNS-STAGING bin.
          // Do NOT increment Product.qty_available.
          await InventoryBalance.findOneAndUpdate(
            { company: req.user.company, warehouse, sku: row.sku, owner: finalOwner, ownerType: finalOwnerType, bin: 'RETURNS-STAGING', lotNumber: row.lotNumber || 'DEFAULT-LOT' },
            { 
              $inc: { qtyAwaitingPutaway: row.qty },
              $min: { entryDate: new Date() }
            },
            { upsert: true, new: true, session }
          );

          await InventoryTransaction.create([{
            transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
            type: 'RETURN',
            sku: row.sku,
            owner: finalOwner,
            ownerType: finalOwnerType,
            warehouse,
            bin: 'RETURNS-STAGING',
            qty: row.qty,
            lotNumber: row.lotNumber || 'DEFAULT-LOT',
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
            owner: finalOwner,
            ownerType: finalOwnerType,
            sku: row.sku,
            productName: row.product || row.sku,
            warehouse,
            qty: row.qty,
            lotNumber: row.lotNumber || 'DEFAULT-LOT',
            fromLocation: 'RETURNS-STAGING',
            toLocation: 'Z-RECEIVING',
            destinationBin: 'Z-RECEIVING',
            priority: 'normal',
            status: 'pending',
            createdBy: req.user.email || req.user.name || 'system',
            company: req.user.company
          }], { session });

        } else if (decision === 'INCIDENT') {
          // RF-P11: INCIDENT decision - create Incident record and quarantine
          await InventoryBalance.findOneAndUpdate(
            { company: req.user.company, warehouse, sku: row.sku, owner: itemOwner, ownerType: itemOwnerType, bin: 'QUARANTINE-REJECTS', lotNumber: row.lotNumber || 'DEFAULT-LOT' },
            { 
              $inc: { qtyQuarantine: row.qty },
              $min: { entryDate: new Date() }
            },
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
            lotNumber: row.lotNumber || 'DEFAULT-LOT',
            referenceId: item.returnId,
            user: req.user.email || req.user.name || 'system',
            timestamp: new Date(),
            company: req.user.company
          }], { session });

          // RF-P11: Create Incident record
          await Incident.create([{
            incidentId: row.incidentId || `INC-RET-${Date.now().toString().slice(-6)}`,
            type: 'Damage',
            sku: row.sku,
            location: 'Returns Zone',
            owner: itemOwner,
            reported_by: req.user.name,
            description: `Return ${item.returnId} INCIDENT decision: ${row.decision_reason || 'Quality Issue'}`,
            company: req.user.company
          }], { session });

        } else if (decision === 'WRITEOFF') {
          // RF-P11: WRITEOFF decision - quarantine and record write-off reason
          await InventoryBalance.findOneAndUpdate(
            { company: req.user.company, warehouse, sku: row.sku, owner: itemOwner, ownerType: itemOwnerType, bin: 'QUARANTINE-REJECTS', lotNumber: row.lotNumber || 'DEFAULT-LOT' },
            { 
              $inc: { qtyQuarantine: row.qty },
              $min: { entryDate: new Date() }
            },
            { upsert: true, new: true, session }
          );

          await InventoryTransaction.create([{
            transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
            type: 'WRITEOFF',
            sku: row.sku,
            owner: itemOwner,
            ownerType: itemOwnerType,
            warehouse,
            bin: 'QUARANTINE-REJECTS',
            qty: row.qty,
            lotNumber: row.lotNumber || 'DEFAULT-LOT',
            referenceId: item.returnId,
            user: req.user.email || req.user.name || 'system',
            reason: row.decision_reason || 'Write-off',
            timestamp: new Date(),
            company: req.user.company
          }], { session });

        } else if (row.qc_status === 'restock' || row.qc_status === 'pending') {
          // Legacy behavior for items without explicit decision
          await InventoryBalance.findOneAndUpdate(
            { company: req.user.company, warehouse, sku: row.sku, owner: itemOwner, ownerType: itemOwnerType, bin: 'RETURNS-STAGING', lotNumber: 'DEFAULT-LOT' },
            { 
              $inc: { qtyAwaitingPutaway: row.qty },
              $min: { entryDate: new Date() }
            },
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
            toLocation: 'Z-RECEIVING',
            destinationBin: 'Z-RECEIVING',
            priority: 'normal',
            status: 'pending',
            createdBy: req.user.email || req.user.name || 'system',
            company: req.user.company
          }], { session });

        } else if (row.qc_status === 'disposed' || row.qc_status === 'rejected') {
          // Legacy behavior for rejected items
          await InventoryBalance.findOneAndUpdate(
            { company: req.user.company, warehouse, sku: row.sku, owner: itemOwner, ownerType: itemOwnerType, bin: 'QUARANTINE-REJECTS', lotNumber: 'DEFAULT-LOT' },
            { 
              $inc: { qtyQuarantine: row.qty },
              $min: { entryDate: new Date() }
            },
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

      // RF-P11: Record audit event for return decision
      const hasFinalDecision = item.items_details?.some(row => 
        row.decision && row.decision !== 'PENDING_DECISION'
      );
      
      if (hasFinalDecision) {
        let auditProduct = null;
        if (item.items_details[0]?.sku) {
          auditProduct = await Product.findOne({ company: req.user.company, sku: item.items_details[0].sku }).session(session);
        }
        await AuditLog.create([{
          event_id: 'EVT-RET-DEC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          timestamp: new Date(),
          event_type: 'return_decision',
          user_id: req.user?._id,
          user_name: req.user?.name || 'System Admin',
          sku: auditProduct?._id,
          quantity: item.items,
          reference_id: item.returnId,
          reason_text: `Return decision recorded for ${item.items_details.length} item(s)`,
          company: req.user.company
        }], { session });
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
          { 
            $inc: { qtyAwaitingPutaway: item.items },
            $min: { entryDate: new Date() }
          },
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
