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
import { resolveActiveInventoryAssetAccount } from '../services/InventoryAssetAccountResolver.js';
import { IdempotencyService } from '../services/IdempotencyService.js';

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
    
    let idempotencyLock = null;
    if (!wasShipped && isShipped) {
      try {
        idempotencyLock = await IdempotencyService.acquireLock(
          req.user.company,
          'SHIPMENT_ACCOUNTING',
          `SHIPMENT_ACCOUNTING_${req.params.id}`,
          req.body
        );
        if (idempotencyLock.status === 'CACHED') {
          await session.abortTransaction();
          session.endSession();
          return res.json(idempotencyLock.response);
        }
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        if (err.status === 409) return res.status(409).json({ message: err.message });
        throw err;
      }
    }

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

      const orderDoc = await Order.findOne({ orderId: item.order, company: req.user.company }).session(session);
      if (!orderDoc) {
        throw new Error(`HARD INTEGRITY EXCEPTION: Order ${item.order} not found for pricing snapshot.`);
      }

      const skuPrices = {};
      if (orderDoc.product_lines) {
        for (const line of orderDoc.product_lines) {
          skuPrices[line.sku] = line.unit_price || 0;
        }
      }

      let totalCogsValue = 0;
      let totalRevenueValue = 0;
      const financialItems = [];
      const jeId = new mongoose.Types.ObjectId(); // Pre-generate ID for idempotency & linkage

      // Resolve the active InventoryAssetAccountMapping WITHIN the transaction, ONCE for this
      // shipment event. Every picked-SKU's processOutgoing call and the consolidated JE line
      // will use the SAME accountId, guaranteeing Ledger snapshot == JE account.
      const inventoryAssetAccountId = await resolveActiveInventoryAssetAccount(
        req.user.company, new Date(), session
      );
      
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
          journalEntryId: jeId,
          inventoryAssetAccountId  // same as JE line below — snapshot immutability
        });

        if (!costResult.skipped && aggItem.ownerType === 'COMPANY') {
          // It's company-owned and processed successfully.
          // appliedValue = unitCostApplied * absolute quantityChange
          const appliedValue = costResult.ledger.unitCostApplied * Math.abs(costResult.ledger.quantityChange);
          totalCogsValue += appliedValue;

          // Calculate Revenue Snapshot
          const unitPrice = skuPrices[aggItem.sku] || 0;
          const revAmount = aggItem.qty * unitPrice;
          totalRevenueValue += revAmount;

          financialItems.push({
            sku: aggItem.sku,
            qty: aggItem.qty,
            unitPriceSnapshot: unitPrice,
            revenueAmount: revAmount
          });
        }
      }

      // Create Consolidated Journal Entry if company-owned COGS/Revenue exists
      if (totalCogsValue > 0 || totalRevenueValue > 0) {
        const accountingConfig = await CompanyAccountingConfig.findOne({ company: req.user.company }).session(session);
        if (!accountingConfig || !accountingConfig.defaultCOGSAccountId || !accountingConfig.defaultInventoryAssetAccountId || !accountingConfig.defaultSalesRevenueAccountId || !accountingConfig.defaultUnbilledReceivableAccountId) {
          throw new Error('HARD ACCOUNTING EXCEPTION: Missing CompanyAccountingConfig or required accounts (COGS/Asset/Rev/Unbilled) for shipping valuation.');
        }

        const currentYear = new Date().getFullYear();
        const jeCounter = await Counter.findOneAndUpdate(
          { _id: `journal_entry_${currentYear}_${req.user.company}` },
          { $inc: { seq: 1 } },
          { new: true, upsert: true, session }
        );
        const jeNumber = `JE-${currentYear}-${String(jeCounter.seq).padStart(5, '0')}`;

        const lines = [];
        if (totalCogsValue > 0) {
          lines.push({
            accountId: accountingConfig.defaultCOGSAccountId,
            account: 'COGS',
            description: 'Cost of Goods Sold',
            debit: totalCogsValue,
            credit: 0
          });
          lines.push({
            accountId: inventoryAssetAccountId,  // snapshot — from active mapping, same as Ledger
            account: 'Inventory Asset',
            description: 'Inventory Asset Deduction',
            debit: 0,
            credit: totalCogsValue
          });
        }
        if (totalRevenueValue > 0) {
          lines.push({
            accountId: accountingConfig.defaultUnbilledReceivableAccountId,
            account: 'Unbilled Receivable',
            description: 'Accrued Unbilled AR',
            debit: totalRevenueValue,
            credit: 0
          });
          lines.push({
            accountId: accountingConfig.defaultSalesRevenueAccountId,
            account: 'Sales Revenue',
            description: 'Revenue recognized at shipment',
            debit: 0,
            credit: totalRevenueValue
          });
        }

        await JournalEntry.create([{
          _id: jeId,
          entryNumber: jeNumber,
          date: new Date(),
          reference: item.shipmentId,
          description: `COGS & Revenue Recognition for Shipment ${item.shipmentId}`,
          entryType: 'manual',
          sourceDocument: { docType: 'other', docNumber: item.shipmentId },
          lines: lines,
          totalDebit: totalCogsValue + totalRevenueValue,
          totalCredit: totalCogsValue + totalRevenueValue,
          status: 'posted',
          postedAt: new Date(),
          company: req.user.company
        }], { session });
      }
      
      // Save the financial snapshot directly on the shipment
      if (financialItems.length > 0) {
        await Model.updateOne({ _id: item._id }, { $set: { financial_items: financialItems } }, { session });
        // Update in memory for returning response
        item.financial_items = financialItems;
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

    if (idempotencyLock) {
      await IdempotencyService.completeLock(idempotencyLock.record._id, item);
    }

    res.json(item);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    if (typeof idempotencyLock !== 'undefined' && idempotencyLock && idempotencyLock.record) {
      await IdempotencyService.failLock(idempotencyLock.record._id, err).catch(e => console.error('Failed to update idempotency failure', e));
    }

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
