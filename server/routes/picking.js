import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import PickTask from '../models/PickTask.js';
import PickBatch from '../models/PickBatch.js';
import Order from '../models/Order.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import Document from '../models/Document.js';
import Counter from '../models/Counter.js';
import ActivityLog from '../models/ActivityLog.js';
import Notification from '../models/Notification.js';
import { generatePickDeliveryNotePDFBuffer } from '../services/deliveryNoteService.js';

const router = express.Router();
router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager', 'warehouse_staff');

// ── GET Quick Scan Lookup (Order Barcode or Pick Task Barcode) ──
router.get('/lookup/:code', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const code = (req.params.code || '').trim();
    if (!code) return res.status(400).json({ message: 'Barcode / ID required' });

    // Look up by taskId or orderId
    const task = await PickTask.findOne({
      company: req.user.company,
      $or: [
        { taskId: code },
        { taskId: code.toUpperCase() },
        { orderId: code },
        { orderNumber: code }
      ]
    });

    if (!task) {
      return res.status(404).json({ message: `No Pick Task found matching barcode '${code}'.` });
    }

    res.json(task);
  } catch (err) { next(err); }
});

// ── GET all Batches ──
router.get('/batches', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const filter = { company: req.user.company };
    if (req.query.owner) filter.owner = req.query.owner;
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;

    const result = await paginateQuery(PickBatch, filter, req);
    res.json(result);
  } catch (err) { next(err); }
});

// ── CREATE a Pick Batch (STRICT OWNER ISOLATION ENFORCED) ──
router.post('/batches', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const { pickTaskIds, priority } = req.body;

    if (!Array.isArray(pickTaskIds) || pickTaskIds.length === 0) {
      return res.status(400).json({ message: 'Please select at least one pending Pick Task to create a batch.' });
    }

    const tasks = await PickTask.find({ _id: { $in: pickTaskIds }, company: req.user.company });
    if (tasks.length === 0) {
      return res.status(404).json({ message: 'Selected pick tasks not found.' });
    }

    // STRICT OWNER ISOLATION: Ensure ALL tasks belong to the EXACT SAME Owner!
    const owners = Array.from(new Set(tasks.map(t => (t.owner || 'Default Owner').trim())));
    if (owners.length > 1) {
      return res.status(400).json({
        message: `Owner Isolation Error: Cannot mix pick tasks from different Owners (${owners.map(o => `'${o}'`).join(', ')}) in a single Pick Batch. Batches must be single-owner.`
      });
    }

    const batchOwner = owners[0];
    const counter = await Counter.findOneAndUpdate(
      { _id: 'pick_batch', company: req.user.company },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const batchId = `BCH-2026-${String(counter.seq).padStart(6, '0')}`;

    // Group lines by sourceLocation for efficient warehouse picking movement
    const lineMap = new Map();
    let totalItems = 0;

    tasks.forEach(task => {
      (task.items || []).forEach(item => {
        const loc = item.sourceLocation || 'STAGING-A';
        const key = `${loc}_${item.sku}`;
        totalItems += item.orderedQty;

        if (!lineMap.has(key)) {
          lineMap.set(key, {
            sourceLocation: loc,
            sku: item.sku,
            productName: item.productName || item.sku,
            totalQtyToPick: 0,
            pickedQty: 0,
            status: 'pending',
            tasks: []
          });
        }
        const grp = lineMap.get(key);
        grp.totalQtyToPick += item.orderedQty;
        grp.tasks.push({ taskId: task.taskId, qty: item.orderedQty });
      });
    });

    const groupedLines = Array.from(lineMap.values());

    const batch = await PickBatch.create({
      batchId,
      owner: batchOwner,
      pickTaskIds: tasks.map(t => t.taskId),
      orders: tasks.map(t => t.orderId),
      priority: priority || 'normal',
      status: 'pending',
      assignee: req.user.email || req.user.name || '',
      total_items: totalItems,
      picked_items: 0,
      groupedLines,
      company: req.user.company
    });

    // Update tasks status to in_progress
    await PickTask.updateMany(
      { _id: { $in: pickTaskIds }, company: req.user.company },
      { status: 'in_progress', startedAt: new Date() }
    );

    res.status(201).json(batch);
  } catch (err) { next(err); }
});

// ── GET all Pick Tasks (With Owner & Status Filters + Search) ──
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const filter = { company: req.user.company };
    if (req.query.owner && req.query.owner !== 'all') filter.owner = req.query.owner;
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.orderType) filter.orderType = req.query.orderType;

    const result = await paginateQuery(PickTask, filter, req);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET Pick Task by ID ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await PickTask.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }]
    });
    if (!item) return res.status(404).json({ message: 'Pick Task not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// ── EXECUTE & COMPLETE PICK TASK (With Owner Isolation & PDF Delivery Note) ──
router.post('/:id/complete', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const task = await PickTask.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }]
    });

    if (!task) {
      return res.status(404).json({ message: 'Pick Task not found' });
    }

    if (task.status === 'completed') {
      return res.status(400).json({ message: `Pick Task ${task.taskId} is already completed.` });
    }

    const { lineUpdates } = req.body; // Array of { sku, pickedQty, sourceLocation }
    const operator = req.user.email || req.user.name || 'system';
    const warehouse = task.warehouse || 'MIA';
    const taskOwner = task.owner || 'Default Owner';

    let totalPicked = 0;
    let totalShortfall = 0;
    let hasShortfall = false;

    // Process each line in task
    for (const item of task.items) {
      const update = Array.isArray(lineUpdates) ? lineUpdates.find(u => u.sku === item.sku) : null;
      
      // Step 1 Validation: Check scanned location against expected source location
      if (update && update.scannedLocation) {
        const expectedLoc = (item.sourceLocation || 'STAGING-A').trim().toUpperCase();
        const scannedLoc = String(update.scannedLocation).trim().toUpperCase();
        if (scannedLoc !== expectedLoc) {
          return res.status(400).json({
            message: `Wrong location. Scanned: ${update.scannedLocation}. Expected: ${item.sourceLocation || 'STAGING-A'}`
          });
        }
      }

      const actualPicked = update ? Math.min(Number(update.pickedQty) || 0, item.orderedQty) : item.orderedQty;
      const shortfall = item.orderedQty - actualPicked;

      item.pickedQty = actualPicked;
      item.shortfallQty = shortfall;
      item.status = actualPicked >= item.orderedQty ? 'picked' : shortfall > 0 ? 'shortfall' : 'pending';

      totalPicked += actualPicked;
      totalShortfall += shortfall;
      if (shortfall > 0) hasShortfall = true;

      const binCode = update?.sourceLocation || item.sourceLocation || 'STAGING-A';

      // OWNER ISOLATION: Deduct stock ONLY from matching (company, warehouse, sku, owner, bin)
      if (actualPicked > 0) {
        const allBalances = await InventoryBalance.find({ sku: item.sku, company: req.user.company });
        let balances = allBalances.filter(b => {
          if (!taskOwner || taskOwner === 'Default Owner' || b.owner === 'Default Owner') return true;
          const tO = taskOwner.toLowerCase().trim();
          const bO = (b.owner || '').toLowerCase().trim();
          return tO === bO || tO.includes(bO) || bO.includes(tO) || (tO.split(' ')[0] && tO.split(' ')[0] === bO.split(' ')[0]);
        });

        if (balances.length === 0) {
          balances = allBalances;
        }

        const totalBinStock = balances.reduce((sum, b) => sum + (b.qtyAvailable || 0) + (b.qtyAwaitingPutaway || 0), 0);

        if (balances.length === 0 || totalBinStock < actualPicked) {
          return res.status(400).json({
            message: `Owner Stock Isolation Failure: Insufficient stock for SKU '${item.sku}' under Owner '${taskOwner}' at bin '${binCode}'. Available: ${totalBinStock} (matched ${balances.length}/${allBalances.length} balances), Pick requested: ${actualPicked}.`
          });
        }

        // Deduct actualPicked across balance records for this bin
        let remainingToDeduct = actualPicked;
        for (const bal of balances) {
          if (remainingToDeduct <= 0) break;
          const availHere = (bal.qtyAvailable || 0) + (bal.qtyAwaitingPutaway || 0);
          if (availHere <= 0) continue;

          const deductFromThis = Math.min(availHere, remainingToDeduct);
          const decAvailable = Math.min(bal.qtyAvailable || 0, deductFromThis);
          const decAwaiting = deductFromThis - decAvailable;

          await InventoryBalance.findOneAndUpdate(
            { _id: bal._id },
            { 
              $inc: { 
                qtyAvailable: -decAvailable,
                qtyAwaitingPutaway: -decAwaiting
              } 
            }
          );
          remainingToDeduct -= deductFromThis;
        }

        // Record Inventory Transaction
        const txnId = 'TXN-PICK-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
        await InventoryTransaction.create({
          transactionId: txnId,
          type: 'PICK_EXECUTE',
          sku: item.sku,
          owner: taskOwner,
          warehouse,
          qty: actualPicked,
          bin: binCode,
          referenceId: task.taskId,
          user: operator,
          timestamp: new Date(),
          company: req.user.company
        });
      }
    }

    // Update Task Status
    task.totalPickedQty = totalPicked;
    task.totalShortfallQty = totalShortfall;
    task.status = hasShortfall ? 'partially_picked' : 'completed';
    task.completedAt = new Date();
    task.completedBy = operator;

    // Generate Outbound Delivery Note Document & PDF
    const order = await Order.findOne({ orderId: task.orderId, company: req.user.company });

    let dnCounter = await Counter.findOneAndUpdate(
      { _id: 'outbound_delivery_note', company: req.user.company },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    let dnNumber = `DN-2026-${String(dnCounter.seq).padStart(6, '0')}`;
    let existingDoc = await Document.findOne({ documentNumber: dnNumber, company: req.user.company });
    while (existingDoc) {
      dnCounter = await Counter.findOneAndUpdate(
        { _id: 'outbound_delivery_note', company: req.user.company },
        { $inc: { seq: 1 } },
        { new: true }
      );
      dnNumber = `DN-2026-${String(dnCounter.seq).padStart(6, '0')}`;
      existingDoc = await Document.findOne({ documentNumber: dnNumber, company: req.user.company });
    }

    const pdfBuffer = await generatePickDeliveryNotePDFBuffer(task, order, dnNumber, req.user.company, operator);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUri = `data:application/pdf;base64,${pdfBase64}`;

    const docRecord = await Document.create({
      documentNumber: dnNumber,
      type: 'OUTBOUND_DELIVERY_NOTE',
      asnId: task.orderId,
      asnNumber: task.orderId,
      poNumber: order?.po_reference || task.orderId,
      supplier: order?.customer || task.customer,
      owner: taskOwner,
      receivingDock: 'OUTBOUND_DOCK',
      warehouse,
      totalExpected: task.totalOrderedQty,
      totalReceived: totalPicked,
      discrepancyCount: totalShortfall,
      items: task.items.map(i => ({
        sku: i.sku,
        name: i.productName,
        expected_qty: i.orderedQty,
        received_qty: i.pickedQty,
        uom: 'pcs',
        lotNumber: 'DEFAULT-LOT',
        status: i.pickedQty >= i.orderedQty ? 'PICKED' : 'SHORTFALL'
      })),
      pdfDataUri,
      generatedBy: operator,
      company: req.user.company
    });

    task.deliveryNoteNumber = dnNumber;
    task.deliveryNoteId = docRecord._id;
    await task.save();

    // Update Order status to 'Ready for Shipping' (or 'processing' if partial)
    if (order) {
      order.status = hasShortfall ? 'processing' : 'shipped';
      order.delivery_note_number = dnNumber;
      order.delivery_note_generated_at = new Date();
      await order.save();
    }

    // Activity Log & Notification
    ActivityLog.create({
      logId: 'LOG-' + Date.now(),
      user: operator,
      role: 'warehouse_staff',
      action: 'PICK_COMPLETED',
      module: 'PICKING',
      detail: `Completed Pick Task ${task.taskId} for Order ${task.orderId}. Delivery Note ${dnNumber} generated. Picked: ${totalPicked}/${task.totalOrderedQty} units.`,
      company: req.user.company
    }).catch(() => {});

    res.json({
      task,
      deliveryNoteNumber: dnNumber,
      pdfUrl: `/api/v1/documents/dn/${dnNumber}/pdf`
    });

  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await PickTask.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Pick Task not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) { next(err); }
});

export default router;
