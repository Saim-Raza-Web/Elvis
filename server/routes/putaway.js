import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import PutawayTask from '../models/PutawayTask.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import Location from '../models/Location.js';
import Product from '../models/Product.js';
import ActivityLog from '../models/ActivityLog.js';
import Notification from '../models/Notification.js';
import { proposeDestinationLocation } from '../services/locationProposalService.js';

const router = express.Router();
router.use(protect);

const requireOpsRole = requireRole('admin', 'manager', 'warehouse_staff');

/** State Machine Transition Validator for Putaway Task */
function isValidPutawayTransition(currentStatus, targetStatus, isOverrideAdmin = false) {
  if (currentStatus === targetStatus) return true;
  if (isOverrideAdmin) return true;

  const TRANSITIONS = {
    pending: ['assigned', 'in_progress', 'cancelled'],
    assigned: ['in_progress', 'pending', 'cancelled'],
    in_progress: ['completed', 'assigned', 'cancelled'],
    completed: [],
    cancelled: []
  };

  const allowed = TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

/** Helper activity logger */
async function logActivity(req, action, module, detail, session) {
  try {
    const opts = session ? { session } : {};
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: req.user?.email || req.user?.name || 'system',
      role: req.user?.role || 'unknown',
      action,
      module,
      detail,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
      timestamp: new Date(),
      company: req.user?.company,
    }], opts);
  } catch (_) {}
}

// ── GET /api/v1/putaway/propose-location — Dynamic Location Proposal Engine ──
// Must be defined BEFORE /:id routes to avoid route collision
router.get('/propose-location', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { sku, warehouse, qty = 1 } = req.query;
    if (!sku) return res.status(400).json({ message: 'sku query parameter is required' });

    const proposal = await proposeDestinationLocation({
      company: req.user.company,
      warehouse: String(warehouse || 'DEFAULT'),
      sku: String(sku),
      qty: Number(qty) || 1
    });
    res.json(proposal);
  } catch (err) { next(err); }
});

// ── GET /api/v1/putaway — List Putaway Queue Tasks ──
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const query = { company: req.user.company };

    if (req.query.search) {
      const s = String(req.query.search).trim();
      const regex = new RegExp(s, 'i');
      query.$or = [
        { taskId: regex },
        { qcId: regex },
        { asnId: regex },
        { asnNumber: regex },
        { sku: regex },
        { productName: regex },
        { fromLocation: regex },
        { toLocation: regex },
        { destinationBin: regex },
        { assignedTo: regex }
      ];
    }

    if (req.query.status && req.query.status !== 'All') {
      query.status = req.query.status;
    }

    if (req.query.priority && req.query.priority !== 'All') {
      query.priority = req.query.priority;
    }

    if (req.query.warehouse) {
      query.warehouse = req.query.warehouse;
    }

    const result = await paginateQuery(PutawayTask, query, req);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/v1/putaway/:id — Single Task Details ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const item = await PutawayTask.findOne({
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }],
      company: req.user.company
    });

    if (!item) return res.status(404).json({ message: 'Putaway task not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// ── POST /api/v1/putaway/:id/assign — Assign Operator ──
router.post('/:id/assign', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const { operatorEmail, __v } = req.body;
    const task = await PutawayTask.findOne({
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }],
      company: req.user.company
    }).session(session);

    if (!task) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Putaway task not found' });
    }

    // Task Re-assignment Lock: Prevent re-assigning in_progress tasks by non-admins
    if (task.status === 'in_progress' && req.user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Task ${task.taskId} is currently in progress by ${task.assignedTo || 'another operator'}. Re-assignment locked.` });
    }

    // OCC Version Check
    if (typeof __v === 'number' && task.__v !== __v) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ message: `Conflict: Task was modified by another operator. Current version: ${task.__v}` });
    }

    const targetStatus = operatorEmail ? 'assigned' : 'pending';
    const isOverrideAdmin = req.user.role === 'admin';

    if (!isValidPutawayTransition(task.status, targetStatus, isOverrideAdmin)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Invalid state transition from '${task.status}' to '${targetStatus}'.` });
    }

    task.assignedTo = operatorEmail || '';
    task.assignedAt = operatorEmail ? new Date() : undefined;
    task.status = targetStatus;
    task.__v = (task.__v || 0) + 1;
    await task.save({ session });

    await logActivity(req, 'PUTAWAY_ASSIGNED', 'PUTAWAY', `Assigned Putaway Task ${task.taskId} to ${operatorEmail || 'Unassigned'}`, session);

    await session.commitTransaction();
    session.endSession();

    res.json({ message: `Successfully assigned Putaway Task ${task.taskId}.`, task });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── POST /api/v1/putaway/:id/start — Start Task Execution ──
router.post('/:id/start', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const task = await PutawayTask.findOne({
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }],
      company: req.user.company
    });

    if (!task) return res.status(404).json({ message: 'Putaway task not found' });

    // Task Lock Check
    const currentUserEmail = req.user.email || req.user.name;
    if (task.assignedTo && task.assignedTo !== currentUserEmail && req.user.role !== 'admin') {
      return res.status(400).json({ message: `Task ${task.taskId} is assigned to ${task.assignedTo}. You cannot start this task.` });
    }

    const isOverrideAdmin = req.user.role === 'admin';
    if (!isValidPutawayTransition(task.status, 'in_progress', isOverrideAdmin)) {
      return res.status(400).json({ message: `Invalid state transition from '${task.status}' to 'in_progress'.` });
    }

    task.status = 'in_progress';
    task.startedAt = task.startedAt || new Date();
    task.assignedTo = task.assignedTo || currentUserEmail;
    task.__v = (task.__v || 0) + 1;
    await task.save();

    await logActivity(req, 'PUTAWAY_STARTED', 'PUTAWAY', `Operator started Putaway Task ${task.taskId}`);

    res.json({ message: `Started Putaway Task ${task.taskId}`, task });
  } catch (err) { next(err); }
});

// ── POST /api/v1/putaway/:id/complete — EXECUTE PUTAWAY & ATOMIC INVENTORY TRANSFER ──
router.post('/:id/complete', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const { destinationBin, scannedTaskBarcode, scannedBinBarcode, scannedSkuBarcode, __v } = req.body;
    const task = await PutawayTask.findOne({
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }],
      company: req.user.company
    }).session(session);

    if (!task) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Putaway task not found' });
    }

    // Point 4: Reject already completed or repeat put-away tasks
    if (task.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Putaway Task ${task.taskId} is already completed. Repeat execution blocked.` });
    }

    // Point 4: OCC Version & Concurrent Race Lock Check
    if (typeof __v === 'number' && task.__v !== __v) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ message: `Conflict: Task ${task.taskId} was modified or completed by another operator. Version mismatch (expected ${task.__v}, received ${__v}).` });
    }

    const isOverrideAdmin = req.user.role === 'admin';
    if (!isValidPutawayTransition(task.status, 'completed', isOverrideAdmin)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Invalid state transition from '${task.status}' to 'completed'.` });
    }

    // Point 4: Comprehensive Barcode Validations (Task, Bin, SKU, Expiry)
    if (scannedTaskBarcode && scannedTaskBarcode.trim() !== task.taskId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Task barcode mismatch: Scanned '${scannedTaskBarcode}', Expected '${task.taskId}'.` });
    }

    if (scannedSkuBarcode && scannedSkuBarcode.trim() !== task.sku) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `SKU barcode mismatch: Scanned '${scannedSkuBarcode}', Expected '${task.sku}'.` });
    }

    const proposedLocation = (task.destinationBin || task.toLocation || '').trim();
    const targetBinCode = (scannedBinBarcode || destinationBin || proposedLocation).trim();

    if (scannedBinBarcode && proposedLocation && scannedBinBarcode.trim() !== proposedLocation && !req.body.allowMisbinOverride) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Location Verification Failed: Scanned shelf/bin barcode '${scannedBinBarcode.trim()}' does not match proposed location '${proposedLocation}'. Incorrect location rejected.` });
    }

    const warehouse = task.warehouse || 'MIA';
    const qty = task.qty;
    const sourceBinCode = task.fromLocation || `${warehouse}-RCV-DOCK1`;

    // Point 1 & Point 2 & Point 3: Bin Existence, Status, Compatibility, & Atomic Concurrent Capacity Validation
    if (targetBinCode !== 'RECEIVING-BUFFER' && targetBinCode !== 'Z-RECEIVING') {
      const loc = await Location.findOne({ code: targetBinCode, company: req.user.company }).session(session);
      if (!loc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Destination bin '${targetBinCode}' does not exist in Location master DB for warehouse ${warehouse}.` });
      }

      if (loc.status === 'LOCKED' || loc.status === 'MAINTENANCE') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Destination bin '${targetBinCode}' is currently locked for ${loc.status}. Putaway blocked.` });
      }

      // Point 2: Mis-bin Rejection / Storage Compatibility Rule Check
      if (task.toLocation && task.toLocation !== 'RECEIVING-BUFFER' && task.toLocation !== 'Z-RECEIVING') {
        const expectedLoc = await Location.findOne({ code: task.toLocation, company: req.user.company }).session(session);
        if (expectedLoc && expectedLoc.zone && loc.zone && expectedLoc.zone !== loc.zone && !req.body.allowMisbinOverride) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: `Mis-bin Rejection: Task ${task.taskId} requires zone '${expectedLoc.zone}', but scanned bin '${targetBinCode}' is in zone '${loc.zone}'.` });
        }
      }

      const product = await Product.findOne({ sku: task.sku, company: req.user.company }).session(session);
      if (product) {
        if (product.isColdStorage && loc.zoneType !== 'COLD_STORAGE') {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: `Storage Compatibility Rule Violated: SKU ${task.sku} requires COLD_STORAGE zone, but destination bin '${targetBinCode}' is '${loc.zoneType || 'AMBIENT'}'.` });
        }
        if (product.isHazmat && loc.zoneType !== 'HAZMAT') {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: `Storage Compatibility Rule Violated: SKU ${task.sku} is HAZMAT, but destination bin '${targetBinCode}' is '${loc.zoneType || 'AMBIENT'}'.` });
        }
      }

      // Point 3: Atomic Concurrent Multi-Task Capacity Check inside Session Transaction
      const maxUnitsAllowed = loc.maxUnits || loc.capacity || 1000;
      const updatedLoc = await Location.findOneAndUpdate(
        {
          _id: loc._id,
          currentUnits: { $lte: maxUnitsAllowed - qty }
        },
        { $inc: { currentUnits: qty, __v: 1 } },
        { session, new: true }
      );

      if (!updatedLoc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Destination bin '${targetBinCode}' capacity exceeded! Max capacity: ${maxUnitsAllowed} units, Incoming: ${qty} units.` });
      }
    }

    // Point 5: Inventory Consistency Verification: Ensure source qtyAwaitingPutaway is sufficient
    const sourceBalance = await InventoryBalance.findOne({
      company: req.user.company,
      warehouse,
      sku: task.sku,
      lotNumber: task.lotNumber || 'DEFAULT-LOT',
      bin: sourceBinCode
    }).session(session);

    const availableToPutaway = sourceBalance ? (sourceBalance.qtyAwaitingPutaway || 0) : 0;
    if (availableToPutaway < qty) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Inventory Invariant Violation: Insufficient stock awaiting putaway at '${sourceBinCode}'. Available: ${availableToPutaway}, Required: ${qty}.` });
    }

    const operator = req.user.email || req.user.name || 'system';

    // 3. Deduct qtyAwaitingPutaway from Source Location in InventoryBalance
    await InventoryBalance.findOneAndUpdate(
      { company: req.user.company, warehouse, sku: task.sku, lotNumber: task.lotNumber || 'DEFAULT-LOT', bin: sourceBinCode },
      { $inc: { qtyAwaitingPutaway: -qty } },
      { upsert: true, new: true, session }
    );

    // 4. Add EXACT qtyAvailable to Destination Location in InventoryBalance
    await InventoryBalance.findOneAndUpdate(
      { company: req.user.company, warehouse, sku: task.sku, lotNumber: task.lotNumber || 'DEFAULT-LOT', bin: targetBinCode },
      { $inc: { qtyAvailable: qty } },
      { upsert: true, new: true, session }
    );

    // 5. Append Rich Immutable Audit Ledger (Point 5)
    const txnId = 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
    const txn = await InventoryTransaction.create([{
      transactionId: txnId,
      type: 'PUTAWAY_COMPLETE',
      sku: task.sku,
      warehouse,
      qty,
      lotNumber: task.lotNumber,
      batchNumber: task.batchNumber,
      asnNumber: task.asnNumber || task.asnId,
      referenceId: task.taskId,
      bin: targetBinCode,
      user: operator,
      timestamp: new Date(),
      company: req.user.company
    }], { session });

    // 6. Update PutawayTask with Atomic OCC Increment
    const updatedTask = await PutawayTask.findOneAndUpdate(
      { _id: task._id, status: { $ne: 'completed' }, __v: task.__v },
      {
        $set: {
          status: 'completed',
          toLocation: targetBinCode,
          destinationBin: targetBinCode,
          completedAt: new Date(),
          completedBy: operator,
          assignedTo: task.assignedTo || operator
        },
        $inc: { __v: 1 }
      },
      { new: true, session }
    );

    if (!updatedTask) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ message: `Conflict: Concurrent update race condition detected on Putaway Task ${task.taskId}. Execution aborted.` });
    }

    // Point 5: Rich Audit Trail in ActivityLog
    const auditDetail = `Completed Putaway Task ${task.taskId} | Operator: ${operator} | SKU: ${task.sku} | Qty: ${qty} | From: ${task.fromLocation} | To: ${targetBinCode} | QC ID: ${task.qcId || 'N/A'} | ASN: ${task.asnNumber || task.asnId || 'N/A'} | TXN ID: ${txnId}`;
    await logActivity(req, 'PUTAWAY_COMPLETED', 'PUTAWAY', auditDetail, session);

    Notification.create([{
      company: req.user.company,
      kind: 'success',
      title: 'Putaway Execution Completed',
      body: `Putaway Task ${task.taskId} completed. ${qty} units of ${task.sku} stored in ${targetBinCode} and released to Available inventory.`,
    }], { session }).catch(() => {});

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: `Putaway Task ${task.taskId} completed successfully. ${qty} units transferred to ${targetBinCode} and released to Available Inventory.`,
      task: updatedTask,
      transactionId: txnId,
      audit: {
        operator,
        completedAt: updatedTask.completedAt,
        oldLocation: task.fromLocation,
        newLocation: targetBinCode,
        qty,
        taskId: task.taskId,
        qcId: task.qcId,
        asnId: task.asnNumber || task.asnId,
        inventoryTransactionId: txnId
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.name === 'VersionError' || err.code === 112 || err.message?.includes('WriteConflict') || err.message?.includes('version') || err.message?.includes('Transaction') || err.message?.includes('Write conflict')) {
      return res.status(409).json({ message: `Conflict: Concurrent race condition detected on Putaway Task execution (${err.message}).` });
    }
    next(err);
  }
});

export default router;
