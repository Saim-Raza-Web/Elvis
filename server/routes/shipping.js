import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Model from '../models/Shipment.js';
import Order from '../models/Order.js';
import ActivityLog from '../models/ActivityLog.js';
import PickTask from '../models/PickTask.js';
import InventoryValuationEngine from '../services/InventoryValuationEngine.js';
import JournalEntry from '../models/JournalEntry.js';
import Counter from '../models/Counter.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['shipmentId', 'customer', 'tracking', 'order'],
      exact: { carrier: 'carrier' },
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

// UPDATE
router.put('/:id', requireOpsRole, async (req, res, next) => {
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

    const wasShipped = existing.status === 'shipped' || existing.status === 'in_transit';
    const isShipped = req.body.status === 'shipped' || req.body.status === 'in_transit';

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true, session }
    );

    if (!wasShipped && isShipped) {
      await Order.findOneAndUpdate(
        { orderId: item.order, company: req.user.company },
        { status: 'shipped' },
        { new: true, session }
      );

      // --- PHASE 8A.4: SHIPPING / COGS ACCOUNTING INTEGRATION ---
      
      if (!item.packId) {
        throw new Error('HARD INTEGRITY EXCEPTION: Shipment lacks packId. Cannot trace to PickTask for COGS.');
      }
      
      const pickTask = await PickTask.findOne({ taskId: item.packId, company: req.user.company }).session(session);
      if (!pickTask) {
        throw new Error(`HARD INTEGRITY EXCEPTION: PickTask ${item.packId} not found.`);
      }

      let totalCogsValue = 0;
      const jeId = new mongoose.Types.ObjectId(); // Pre-generate ID for idempotency & linkage
      
      // Aggregate picking lines by sku + owner + ownerType to prevent URN collisions
      const aggregatedLines = {};
      for (const ptItem of pickTask.items) {
        if (!ptItem.pickedQty || ptItem.pickedQty <= 0) continue;
        if (!ptItem.inventoryOwner) {
          throw new Error(`HARD ACCOUNTING EXCEPTION: Missing owner on PickTask line for SKU ${ptItem.sku}`);
        }
        if (!ptItem.ownerType) {
          throw new Error(`HARD ACCOUNTING EXCEPTION: Missing ownerType on PickTask line for SKU ${ptItem.sku}`);
        }
        const key = `${ptItem.sku}::${ptItem.inventoryOwner}::${ptItem.ownerType}`;
        if (!aggregatedLines[key]) {
          aggregatedLines[key] = {
            sku: ptItem.sku,
            owner: ptItem.inventoryOwner,
            ownerType: ptItem.ownerType,
            qty: 0
          };
        }
        aggregatedLines[key].qty += ptItem.pickedQty;
      }

      for (const key in aggregatedLines) {
        const aggItem = aggregatedLines[key];
        const costResult = await InventoryValuationEngine.processOutgoing(session, {
          company: req.user.company,
          sku: aggItem.sku,
          owner: aggItem.owner,
          ownerType: aggItem.ownerType,
          qty: aggItem.qty,
          eventType: 'SHIPMENT',
          referenceId: item.shipmentId,
          journalEntryId: jeId
        });

        if (!costResult.skipped) {
          // It's company-owned and processed successfully.
          // appliedValue = unitCostApplied * absolute quantityChange
          const appliedValue = costResult.ledger.unitCostApplied * Math.abs(costResult.ledger.quantityChange);
          totalCogsValue += appliedValue;
        }
      }

      // Create Consolidated Journal Entry if company-owned COGS exists
      if (totalCogsValue > 0) {
        const accountingConfig = await CompanyAccountingConfig.findOne({ company: req.user.company }).session(session);
        if (!accountingConfig || !accountingConfig.defaultCOGSAccountId || !accountingConfig.defaultInventoryAssetAccountId) {
          throw new Error('HARD ACCOUNTING EXCEPTION: Missing CompanyAccountingConfig or required accounts (COGS/Inventory Asset) for shipping valuation.');
        }

        const jeCounter = await Counter.findOneAndUpdate(
          { _id: `journal_entry_${req.user.company}` },
          { $inc: { seq: 1 } },
          { new: true, upsert: true, session }
        );
        const jeNumber = `JE-${new Date().getFullYear()}-${String(jeCounter.seq).padStart(5, '0')}`;

        await JournalEntry.create([{
          _id: jeId,
          entryNumber: jeNumber,
          date: new Date(),
          reference: item.shipmentId,
          description: `COGS Recognition for Shipment ${item.shipmentId}`,
          entryType: 'manual',
          sourceDocument: { docType: 'other', docNumber: item.shipmentId },
          lines: [
            {
              accountId: accountingConfig.defaultCOGSAccountId,
              account: 'COGS',
              description: 'Cost of Goods Sold',
              debit: totalCogsValue,
              credit: 0
            },
            {
              accountId: accountingConfig.defaultInventoryAssetAccountId,
              account: 'Inventory Asset',
              description: 'Inventory Asset Deduction',
              debit: 0,
              credit: totalCogsValue
            }
          ],
          totalDebit: totalCogsValue,
          totalCredit: totalCogsValue,
          status: 'posted',
          postedAt: new Date(),
          company: req.user.company
        }], { session });
      }

      // --- END ACCOUNTING INTEGRATION ---

      await ActivityLog.create([{
        logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        user: req.user.name || req.user.email || 'system',
        role: 'warehouse_staff',
        action: 'SHIPPED_ORDER',
        module: 'SHIPPING',
        detail: `Shipped order ${item.order} via ${item.carrier || 'Pending'} (${item.tracking || 'Pending'})`,
        company: req.user.company
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
