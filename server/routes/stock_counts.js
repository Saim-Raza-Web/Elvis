import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { paginateQuery } from '../utils/pagination.js';
import StockCount from '../models/StockCount.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import PickTask from '../models/PickTask.js';
import IdempotencyRecord from '../models/IdempotencyRecord.js';
import ActivityLog from '../models/ActivityLog.js';
import JournalEntry from '../models/JournalEntry.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';
import InventoryValuationEngine from '../services/InventoryValuationEngine.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

// GET all stock counts
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const result = await paginateQuery(StockCount, { company: req.user.company }, req, { sort: '-createdAt' });
    res.json(result);
  } catch (err) { next(err); }
});

// GET single stock count
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await StockCount.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// CREATE a new stock count session
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { name, scope, scopeValue } = req.body;
    
    if (req.context && req.context.warehouses && req.context.warehouses.length > 1) {
      return res.status(400).json({ message: 'Multiple warehouses provided. This endpoint requires exactly one warehouse.' });
    }
    const warehouse = req.context?.warehouse?.code || 'MIA';

    let productQuery = { company: req.user.company };
    if (scope === 'product' && scopeValue) productQuery.sku = scopeValue;

    // Use InventoryBalance for actual lines instead of Product catalogue
    let balQuery = { company: req.user.company, warehouse };
    if (scope === 'product' && scopeValue) balQuery.sku = scopeValue;
    if (scope === 'zone' && scopeValue) balQuery.bin = new RegExp(`^${scopeValue}`, 'i'); // Simple regex for bins in zone

    const balances = await InventoryBalance.find(balQuery);
    
    const lines = balances
      .filter(p => p.qtyAvailable > 0 || p.qtyReserved > 0)
      .map(p => ({
        location: p.bin,
        sku: p.sku,
        product: p.sku, // Ideally fetch name, but keeping simple
        theoretical_qty: (p.qtyAvailable || 0) + (p.qtyReserved || 0),
        counted_qty: null,
        discrepancy: 0,
        status: 'pending'
      }));

    const countId = `SC-${Date.now().toString().slice(-8)}`;
    const countName = (name && String(name).trim()) || `${warehouse} - ${(scope || 'Cycle').toUpperCase()} Count (${new Date().toISOString().slice(0, 10)})`;

    const item = await StockCount.create({
      countId,
      name: countName,
      scope: scope || 'zone',
      scopeValue,
      warehouse,
      status: 'open',
      lines,
      startedBy: req.user.name || req.user.email || 'Admin',
      company: req.user.company
    });

    res.status(201).json(item);
  } catch (err) { next(err); }
});

// Helper: Process Discrepancies
async function processDiscrepancy(line, company, warehouse, session, operator) {
  if (line.discrepancy === 0) return;

  const sku = line.sku;
  const bin = line.location || 'UNKNOWN';

  // Find balance for this bin
  const bal = await InventoryBalance.findOne({ company, warehouse, sku, bin }).session(session);
  if (!bal) {
    if (line.discrepancy > 0) {
      if (!line.ownerType || !['COMPANY', 'CUSTOMER'].includes(line.ownerType)) {
        throw new Error(`HARD FAILURE: Discovered inventory for SKU ${sku} requires explicit ownerType (COMPANY or CUSTOMER). UNKNOWN is forbidden.`);
      }
      
      const newOwner = line.owner || 'Default Owner';

      await InventoryBalance.create([{
        company, warehouse, sku, bin, owner: newOwner, ownerType: line.ownerType, lotNumber: 'DEFAULT-LOT', qtyAvailable: line.discrepancy
      }], { session });
      
      await Product.findOneAndUpdate(
        { sku, company },
        { $inc: { qty_available: line.discrepancy } },
        { session }
      );
      
      await InventoryTransaction.create([{
        transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
        type: 'ADJUSTMENT',
        sku, warehouse, bin, qty: line.discrepancy, owner: newOwner, ownerType: line.ownerType, user: operator, company
      }], { session });

      if (line.ownerType === 'COMPANY') {
        const accConfig = await CompanyAccountingConfig.findOne({ company }).session(session);
        if (!accConfig || !accConfig.defaultInventoryAssetAccountId || !accConfig.defaultCOGSAccountId) {
          throw new Error(`Accounting Config Violation: Missing default Inventory Asset or COGS accounts for company.`);
        }

        const jeId = new mongoose.Types.ObjectId();
        const costResult = await InventoryValuationEngine.processCycleCount(session, {
          company, sku, owner: newOwner, ownerType: line.ownerType, qtyChange: line.discrepancy, referenceId: line._id ? line._id.toString() : 'SC-' + Date.now(), journalEntryId: jeId
        });

        if (!costResult.skipped && costResult.ledger) {
          const financialValue = Math.round((line.discrepancy * costResult.ledger.unitCostApplied) * 10000) / 10000;
          const jeCount = await JournalEntry.countDocuments({ company }).session(session);
          const jeNumber = `JE-${new Date().getFullYear()}-${String(jeCount + 1).padStart(6, '0')}`;
          
          await JournalEntry.create([{
            _id: jeId,
            entryNumber: jeNumber,
            date: new Date(),
            reference: 'CYCLE_COUNT_GAIN',
            description: `Cycle Count Gain for SKU ${sku} (Qty: ${line.discrepancy})`,
            entryType: 'manual',
            lines: [
              { accountId: accConfig.defaultInventoryAssetAccountId, accountCodeSnapshot: accConfig.defaultInventoryAssetAccountCode, account: accConfig.defaultInventoryAssetAccountName, debit: financialValue, credit: 0 },
              { accountId: accConfig.defaultCOGSAccountId, accountCodeSnapshot: accConfig.defaultCOGSAccountCode, account: accConfig.defaultCOGSAccountName, debit: 0, credit: financialValue }
            ],
            totalDebit: financialValue, totalCredit: financialValue,
            status: 'posted', postedAt: new Date(), postedBy: operator, company
          }], { session });
        }
      }
    }
    return;
  }

  if (line.discrepancy > 0) {
    bal.qtyAvailable += line.discrepancy;
    await bal.save({ session });
    
    await Product.findOneAndUpdate(
      { sku, company },
      { $inc: { qty_available: line.discrepancy } },
      { session }
    );
    
    await InventoryTransaction.create([{
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      type: 'ADJUSTMENT',
      sku, warehouse, bin, qty: line.discrepancy, owner: bal.owner, ownerType: bal.ownerType, user: operator, company
    }], { session });

    if (bal.ownerType === 'COMPANY') {
      const accConfig = await CompanyAccountingConfig.findOne({ company }).session(session);
      if (!accConfig || !accConfig.defaultInventoryAssetAccountId || !accConfig.defaultCOGSAccountId) {
        throw new Error(`Accounting Config Violation: Missing default Inventory Asset or COGS accounts for company.`);
      }

      const jeId = new mongoose.Types.ObjectId();
      const costResult = await InventoryValuationEngine.processCycleCount(session, {
        company, sku, owner: bal.owner, ownerType: bal.ownerType, qtyChange: line.discrepancy, referenceId: line._id ? line._id.toString() : 'SC-' + Date.now(), journalEntryId: jeId
      });

      if (!costResult.skipped && costResult.ledger) {
        const financialValue = Math.round((line.discrepancy * costResult.ledger.unitCostApplied) * 10000) / 10000;
        const jeCount = await JournalEntry.countDocuments({ company }).session(session);
        const jeNumber = `JE-${new Date().getFullYear()}-${String(jeCount + 1).padStart(6, '0')}`;
        
        await JournalEntry.create([{
          _id: jeId,
          entryNumber: jeNumber,
          date: new Date(),
          reference: 'CYCLE_COUNT_GAIN',
          description: `Cycle Count Gain for SKU ${sku} (Qty: ${line.discrepancy})`,
          entryType: 'manual',
          lines: [
            { accountId: accConfig.defaultInventoryAssetAccountId, accountCodeSnapshot: accConfig.defaultInventoryAssetAccountCode, account: accConfig.defaultInventoryAssetAccountName, debit: financialValue, credit: 0 },
            { accountId: accConfig.defaultCOGSAccountId, accountCodeSnapshot: accConfig.defaultCOGSAccountCode, account: accConfig.defaultCOGSAccountName, debit: 0, credit: financialValue }
          ],
          totalDebit: financialValue, totalCredit: financialValue,
          status: 'posted', postedAt: new Date(), postedBy: operator, company
        }], { session });
      }
    }
  } else {
    // Negative discrepancy (Shortfall)
    let shortfall = Math.abs(line.discrepancy);
    let deductionFromAvailable = Math.min(bal.qtyAvailable, shortfall);
    
    if (deductionFromAvailable > 0) {
      bal.qtyAvailable -= deductionFromAvailable;
      shortfall -= deductionFromAvailable;
    }
    
    if (shortfall > 0) {
      // Must steal from Reserved
      // 1. Find Pending PickTasks holding this SKU in this BIN
      const pickTasks = await PickTask.find({
        company,
        warehouse,
        status: { $in: ['pending', 'partially_picked'] },
        'items.sku': sku,
        'items.sourceLocation': bin
      }).session(session);
      
      for (const pt of pickTasks) {
        if (shortfall <= 0) break;
        
        for (const item of pt.items) {
          if (item.sku === sku && item.sourceLocation === bin && item.status !== 'picked') {
            const reservedHere = item.orderedQty - item.pickedQty;
            if (reservedHere > 0) {
              const amountToSteal = Math.min(reservedHere, shortfall);
              
              // Revert the reservation in InventoryBalance
              bal.qtyReserved -= amountToSteal;
              // We do NOT add to qtyAvailable because it immediately disappears due to discrepancy!
              // But mathematically: we revert to Available, then deduct discrepancy. Net: -amountToSteal from Reserved.
              shortfall -= amountToSteal;
              
              item.status = 'shortfall';
              item.shortfallQty = amountToSteal;
              pt.status = 'blocked';
              
              await ActivityLog.create([{
                logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                user: 'SYSTEM',
                action: 'PICKTASK_SHORTFALL',
                module: 'PICKING',
                detail: `Cycle count shortfall caused PickTask ${pt.taskId} to lose ${amountToSteal} reserved units of ${sku} from ${bin}.`,
                company
              }], { session });
            }
          }
        }
        await pt.save({ session });
      }
      
      if (shortfall > 0) {
        throw new Error(`Critical Integrity Error: Negative inventory detected for SKU ${sku} in Bin ${bin}. Cannot absorb shortfall of ${shortfall}.`);
      }
    }
    
    await bal.save({ session });
    
    // Decrease global available (only by deductionFromAvailable, since the stolen reserved was never in Product.qty_available anyway!)
    // Wait, theoretically if we stole from Reserved, we didn't touch Product.qty_available since it only tracks qtyAvailable.
    // Correct! Product.qty_available represents ONLY physically available stock.
    if (deductionFromAvailable > 0) {
      await Product.findOneAndUpdate(
        { sku, company },
        { $inc: { qty_available: -deductionFromAvailable } },
        { session }
      );
    }
    
    await InventoryTransaction.create([{
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      type: 'ADJUSTMENT',
      sku, warehouse, bin, qty: line.discrepancy, owner: bal.owner, ownerType: bal.ownerType, user: operator, company
    }], { session });

    if (bal.ownerType === 'COMPANY') {
      const accConfig = await CompanyAccountingConfig.findOne({ company }).session(session);
      if (!accConfig || !accConfig.defaultInventoryAssetAccountId || !accConfig.defaultCOGSAccountId) {
        throw new Error(`Accounting Config Violation: Missing default Inventory Asset or COGS accounts for company.`);
      }

      const jeId = new mongoose.Types.ObjectId();
      const costResult = await InventoryValuationEngine.processCycleCount(session, {
        company, sku, owner: bal.owner, ownerType: bal.ownerType, qtyChange: line.discrepancy, referenceId: line._id ? line._id.toString() : 'SC-' + Date.now(), journalEntryId: jeId
      });

      if (!costResult.skipped && costResult.ledger) {
        const financialValue = Math.round((Math.abs(line.discrepancy) * costResult.ledger.unitCostApplied) * 10000) / 10000;
        const jeCount = await JournalEntry.countDocuments({ company }).session(session);
        const jeNumber = `JE-${new Date().getFullYear()}-${String(jeCount + 1).padStart(6, '0')}`;
        
        await JournalEntry.create([{
          _id: jeId,
          entryNumber: jeNumber,
          date: new Date(),
          reference: 'CYCLE_COUNT_SHRINK',
          description: `Cycle Count Shrink for SKU ${sku} (Qty: ${Math.abs(line.discrepancy)})`,
          entryType: 'manual',
          lines: [
            { accountId: accConfig.defaultCOGSAccountId, accountCodeSnapshot: accConfig.defaultCOGSAccountCode, account: accConfig.defaultCOGSAccountName, debit: financialValue, credit: 0 },
            { accountId: accConfig.defaultInventoryAssetAccountId, accountCodeSnapshot: accConfig.defaultInventoryAssetAccountCode, account: accConfig.defaultInventoryAssetAccountName, debit: 0, credit: financialValue }
          ],
          totalDebit: financialValue, totalCredit: financialValue,
          status: 'posted', postedAt: new Date(), postedBy: operator, company
        }], { session });
      }
    }
  }
}

// UPDATE count session (status transition or items/lines update)
router.put('/:id', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }
    
    const count = await StockCount.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!count) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Count session not found' });
    }

    if (count.status === 'closed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Count already closed' });
    }

    if (req.body.status) {
      const statusMap = { scheduled: 'open', in_progress: 'in_progress', review: 'pending_approval', completed: 'closed', cancelled: 'closed' };
      count.status = statusMap[req.body.status] || req.body.status;
    }

    if (req.body.items && Array.isArray(req.body.items)) {
      count.lines = req.body.items.map(it => ({
        sku: it.sku,
        product: it.product || it.sku,
        location: it.location,
        theoretical_qty: it.expected_qty ?? it.theoretical_qty ?? 0,
        counted_qty: it.counted_qty ?? 0,
        discrepancy: it.discrepancy ?? ((it.counted_qty ?? 0) - (it.expected_qty ?? it.theoretical_qty ?? 0)),
        owner: it.owner || 'Default Owner',
        ownerType: it.ownerType || undefined,
        status: it.status || 'counted'
      }));
    }

    if (count.status === 'closed' || req.body.status === 'completed') {
      for (const line of count.lines) {
        if (line.status === 'counted' && line.discrepancy !== 0) {
          await processDiscrepancy(line, req.user.company, count.warehouse, session, req.user.name || 'System');
          line.status = 'adjusted';
        }
      }
      count.status = 'closed';
      count.approvedBy = req.user.name || req.user.email || 'Admin';
      count.closedAt = new Date();
    }

    await count.save({ session });
    await session.commitTransaction();
    session.endSession();
    res.json(count);
  } catch (err) { 
    await session.abortTransaction();
    session.endSession();
    next(err); 
  }
});

// UPDATE a line (operator scans a count)
router.put('/:id/line/:lineId', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { counted_qty } = req.body;
    const count = await StockCount.findOne({ _id: req.params.id, company: req.user.company });
    if (!count) return res.status(404).json({ message: 'Count session not found' });
    if (count.status === 'closed') return res.status(400).json({ message: 'Already closed' });

    const line = count.lines.id(req.params.lineId);
    if (!line) return res.status(404).json({ message: 'Line not found' });

    line.counted_qty = counted_qty;
    line.discrepancy = counted_qty - line.theoretical_qty;
    line.status = 'counted';

    if (count.status === 'open') count.status = 'in_progress';
    await count.save();
    res.json(count);
  } catch (err) { next(err); }
});

// CLOSE count & apply adjustments
router.put('/:id/close', requireOpsRole, async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey) {
    const existingReq = await IdempotencyRecord.findOne({ key: idempotencyKey, company: req.user.company });
    if (existingReq) return res.json(existingReq.responseBody);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const count = await StockCount.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!count) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Count session not found' });
    }
    if (count.status === 'closed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Already closed' });
    }

    for (const line of count.lines) {
      if (line.status === 'counted' && line.discrepancy !== 0) {
        await processDiscrepancy(line, req.user.company, count.warehouse, session, req.user.name || 'System');
        line.status = 'adjusted';
      }
    }

    count.status = 'closed';
    count.approvedBy = req.user.name;
    count.closedAt = new Date();
    await count.save({ session });

    if (idempotencyKey) {
      await IdempotencyRecord.create([{
        key: idempotencyKey,
        responseBody: count,
        company: req.user.company,
        createdAt: new Date()
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();
    res.json(count);
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
    const item = await StockCount.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

export default router;
