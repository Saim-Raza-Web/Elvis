import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole, requireOfficeAccess } from '../middleware/auth.js';
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
import PackTask from '../models/PackTask.js';
import Product from '../models/Product.js';
import Location from '../models/Location.js';
import LocationOverride from '../models/LocationOverride.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Warehouse from '../models/Warehouse.js';
import { generatePickDeliveryNotePDFBuffer } from '../services/deliveryNoteService.js';

const router = express.Router();
router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager', 'warehouse_staff');
const blockOffice = requireOfficeAccess;

/**
 * Parse numeric value from location code (e.g., "A-01-02-03" → aisle=1, rack=2, shelf=3)
 * Returns { aisle, rack, shelf, bin } with numeric values where possible
 */
function parseLocationParts(locCode) {
  if (!locCode) return { aisle: null, rack: null, shelf: null, bin: locCode };

  // Try to parse structured location codes like "A-01-02-03" or "AISLE-01-RACK-02-SHELF-03"
  const parts = locCode.split(/[-_]/).map(p => {
    const num = parseInt(p, 10);
    return isNaN(num) ? p.toUpperCase() : num;
  });

  // Heuristic: try to identify aisle, rack, shelf, bin from parts
  let aisle = null, rack = null, shelf = null, bin = locCode;

  if (parts.length >= 1) aisle = parts[0];
  if (parts.length >= 2) rack = parts[1];
  if (parts.length >= 3) shelf = parts[2];
  if (parts.length >= 4) bin = parts[3];

  return { aisle, rack, shelf, bin };
}

/**
 * Compare two location codes for deterministic sorting
 * Priority: aisle → rack → shelf → bin
 * Numeric values sort before alphanumeric
 */
function compareLocations(a, b) {
  const aParts = parseLocationParts(a);
  const bParts = parseLocationParts(b);

  // Compare aisle
  const aisleCmp = compareMixed(aParts.aisle, bParts.aisle);
  if (aisleCmp !== 0) return aisleCmp;

  // Compare rack
  const rackCmp = compareMixed(aParts.rack, bParts.rack);
  if (rackCmp !== 0) return rackCmp;

  // Compare shelf
  const shelfCmp = compareMixed(aParts.shelf, bParts.shelf);
  if (shelfCmp !== 0) return shelfCmp;

  // Compare bin
  return compareMixed(aParts.bin, bParts.bin);
}

/**
 * Compare two values where each may be numeric or string
 * Numeric values sort before string values
 */
function compareMixed(a, b) {
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';

  if (aNum && bNum) return a - b;
  if (aNum && !bNum) return -1; // numbers before strings
  if (!aNum && bNum) return 1;  // strings after numbers

  // Both strings - locale compare
  const aStr = String(a || '');
  const bStr = String(b || '');
  return aStr.localeCompare(bStr);
}

/**
 * Sort grouped lines by warehouse physical route (aisle → rack → shelf → bin)
 * Uses Location records for actual warehouse layout data where available
 */
async function optimizeGroupedLinesRoute(groupedLines, companyId, warehouse) {
  // Fetch location records for all source locations
  const locationCodes = [...new Set(groupedLines.map(gl => gl.sourceLocation))];
  const locations = await Location.find({
    company: companyId,
    code: { $in: locationCodes }
  }).lean();

  const locationMap = new Map(locations.map(loc => [loc.code, loc]));

  // Sort grouped lines using location data with fallback to code parsing
  const sortedLines = [...groupedLines].sort((a, b) => {
    const locA = locationMap.get(a.sourceLocation);
    const locB = locationMap.get(b.sourceLocation);

    // If we have Location records, use their structured fields
    if (locA && locB) {
      const aisleCmp = compareMixed(locA.aisle, locB.aisle);
      if (aisleCmp !== 0) return aisleCmp;

      // For rack/shelf, check locationType enum order first
      const typeOrder = { 'PICK_FACE': 0, 'SHELF': 1, 'RACK': 2, 'PALLET': 3, 'FLOOR': 4, 'RESERVE': 5 };
      const typeCmp = (typeOrder[locA.locationType] || 99) - (typeOrder[locB.locationType] || 99);
      if (typeCmp !== 0) return typeCmp;

      const rackCmp = compareMixed(locA.shelf, locB.shelf); // shelf field sometimes used for rack level
      if (rackCmp !== 0) return rackCmp;

      const shelfCmp = compareMixed(locA.bin, locB.bin);
      if (shelfCmp !== 0) return shelfCmp;

      return compareMixed(locA.code, locB.code);
    }

    // Fallback: parse from location codes
    return compareLocations(a.sourceLocation, b.sourceLocation);
  });

  return sortedLines;
}

// ── GET Quick Scan Lookup (Order Barcode or Pick Task Barcode) ──
router.get('/lookup/:code', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    if (req.user.role === 'office') {
      return res.status(403).json({ message: 'Office users do not have access to warehouse picking tasks' });
    }

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

    // Role-specific scoping on lookup
    if (req.user.role === 'client_3pl') {
      if (!req.user.clientId) {
        return res.status(403).json({ message: 'Client 3PL user must have an associated client' });
      }
      const client = await Client.findOne({ _id: req.user.clientId, company: req.user.company });
      if (!client || !client.active || task.owner !== client.name) {
        return res.status(403).json({ message: 'Access denied: task belongs to another owner' });
      }
    } else if (req.user.role === 'management') {
      if (!req.user.warehouses || req.user.warehouses.length === 0) {
        return res.status(403).json({ message: 'Access denied: task belongs to an unassigned warehouse' });
      }
      const assignedWhDocs = await Warehouse.find({ _id: { $in: req.user.warehouses }, company: req.user.company }).lean();
      const assignedCodes = assignedWhDocs.map(w => w.code);
      if (!assignedCodes.includes(task.warehouse)) {
        return res.status(403).json({ message: 'Access denied: task belongs to an unassigned warehouse' });
      }
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

// ── CREATE a Pick Batch (STRICT OWNER ISOLATION ENFORCED + DUPLICATE ASSIGNMENT PREVENTION + ROUTE OPTIMIZATION) ──
router.post('/batches', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }
    const { pickTaskIds, priority } = req.body;

    if (!Array.isArray(pickTaskIds) || pickTaskIds.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Please select at least one pending Pick Task to create a batch.' });
    }

    const tasks = await PickTask.find({ _id: { $in: pickTaskIds }, company: req.user.company }).session(session);
    if (tasks.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Selected pick tasks not found.' });
    }

    // STRICT OWNER ISOLATION: Ensure ALL tasks belong to the EXACT SAME Owner!
    const owners = Array.from(new Set(tasks.map(t => (t.owner || 'Default Owner').trim())));
    if (owners.length > 1) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Owner Isolation Error: Cannot mix pick tasks from different Owners (${owners.map(o => `'${o}'`).join(', ')}) in a single Pick Batch. Batches must be single-owner.`
      });
    }

    // STRICT WAREHOUSE ISOLATION: Ensure ALL tasks belong to the EXACT SAME Warehouse!
    const warehouses = Array.from(new Set(tasks.map(t => (t.warehouse || 'MIA').trim())));
    if (warehouses.length > 1) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Warehouse Isolation Error: Cannot mix pick tasks from different Warehouses (${warehouses.map(w => `'${w}'`).join(', ')}) in a single Pick Batch. Batches must be single-warehouse.`
      });
    }

    // DUPLICATE ASSIGNMENT PREVENTION: Check if any task is already in an active batch
    const activeBatches = await PickBatch.find({
      company: req.user.company,
      status: { $in: ['pending', 'in_progress'] },
      pickTaskIds: { $in: tasks.map(t => t.taskId) }
    }).session(session);

    if (activeBatches.length > 0) {
      const conflictingTasks = [];
      for (const batch of activeBatches) {
        const conflictIds = batch.pickTaskIds.filter(id => tasks.some(t => t.taskId === id));
        conflictingTasks.push(...conflictIds);
      }
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Duplicate Assignment Error: PickTasks [${conflictingTasks.join(', ')}] are already assigned to active batch(es). Complete or cancel those batches first.`
      });
    }

    const batchOwner = owners[0];
    const warehouse = tasks[0]?.warehouse || 'MIA';

    const counter = await Counter.findOneAndUpdate(
      { _id: `pick_batch_${req.user.company}`, company: req.user.company },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true, session }
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

    let groupedLines = Array.from(lineMap.values());

    // ROUTE OPTIMIZATION: Sort by aisle → rack → shelf → bin
    groupedLines = await optimizeGroupedLinesRoute(groupedLines, req.user.company, warehouse);

    const batch = await PickBatch.create([{
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
    }], { session });

    // Update tasks status to in_progress
    await PickTask.updateMany(
      { _id: { $in: pickTaskIds }, company: req.user.company },
      { status: 'in_progress', startedAt: new Date() },
      { session }
    );

    // AUDIT: Batch created
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: req.user.name || req.user.email || 'system',
      role: req.user.role || 'warehouse_staff',
      action: 'BATCH_CREATED',
      module: 'PICKING',
      detail: `Pick batch ${batchId} created with ${tasks.length} tasks for owner ${batchOwner}`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json(batch[0]);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.name === 'MongoServerError' && (err.code === 112 || err.message?.includes('Write conflict') || err.message?.includes('WriteConflict'))) {
      return res.status(409).json({ message: 'Concurrency conflict: concurrent modification detected, please retry.' });
    }
    next(err);
  }
});

// ── COMPLETE a Pick Batch (ORCHESTRATES INDIVIDUAL PICK TASK COMPLETIONS) ──
router.put('/batches/:id/complete', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const batch = await PickBatch.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { batchId: req.params.id }]
    }).session(session);

    if (!batch) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Pick batch not found' });
    }

    if (batch.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Pick batch ${batch.batchId} is already completed.` });
    }

    if (batch.status === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Pick batch ${batch.batchId} is cancelled and cannot be completed.` });
    }

    // Fetch all associated PickTasks
    const tasks = await PickTask.find({
      company: req.user.company,
      taskId: { $in: batch.pickTaskIds }
    }).session(session);

    if (tasks.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'No pick tasks found for this batch' });
    }

    // Check if all tasks are completed
    const incompleteTasks = tasks.filter(t => t.status !== 'completed');
    if (incompleteTasks.length > 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Cannot complete batch: ${incompleteTasks.length} task(s) are not completed. Complete all tasks first.`,
        incompleteTaskIds: incompleteTasks.map(t => t.taskId)
      });
    }

    // Update batch status to completed
    batch.status = 'completed';
    batch.picked_items = batch.total_items;
    await batch.save({ session });

    // AUDIT: Batch completed
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: req.user.name || req.user.email || 'system',
      role: req.user.role || 'warehouse_staff',
      action: 'BATCH_COMPLETED',
      module: 'PICKING',
      detail: `Pick batch ${batch.batchId} completed with ${tasks.length} tasks`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.json(batch);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── CANCEL a Pick Batch ──
router.put('/batches/:id/cancel', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const batch = await PickBatch.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { batchId: req.params.id }]
    }).session(session);

    if (!batch) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Pick batch not found' });
    }

    if (batch.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Pick batch ${batch.batchId} is already completed and cannot be cancelled.` });
    }

    if (batch.status === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Pick batch ${batch.batchId} is already cancelled.` });
    }

    // Update batch status to cancelled
    batch.status = 'cancelled';
    await batch.save({ session });

    // Reset associated PickTasks to pending
    await PickTask.updateMany(
      { company: req.user.company, taskId: { $in: batch.pickTaskIds } },
      { status: 'pending', startedAt: null },
      { session }
    );

    // AUDIT: Batch cancelled
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: req.user.name || req.user.email || 'system',
      role: req.user.role || 'warehouse_staff',
      action: 'BATCH_CANCELLED',
      module: 'PICKING',
      detail: `Pick batch ${batch.batchId} cancelled`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.json(batch);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── GET all Pick Tasks (With Owner & Status Filters + Search) ──
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    // Office role gets no physical picking task execution/queue access
    if (req.user.role === 'office') {
      return res.status(403).json({ message: 'Office users do not have access to warehouse picking tasks' });
    }

    const filter = { company: req.user.company };

    // Role-specific scoping
    if (req.user.role === 'client_3pl') {
      if (!req.user.clientId) {
        return res.status(403).json({ message: 'Client 3PL user must have an associated client' });
      }
      const client = await Client.findOne({ _id: req.user.clientId, company: req.user.company });
      if (!client || !client.active) {
        return res.status(403).json({ message: 'Associated client not found or inactive' });
      }
      if (req.query.owner && req.query.owner !== 'all' && req.query.owner !== client.name) {
        return res.status(403).json({ message: 'Client 3PL users can only access their own owner data' });
      }
      filter.owner = client.name;
    } else if (req.user.role === 'management') {
      if (!req.user.warehouses || req.user.warehouses.length === 0) {
        filter.warehouse = { $in: [] };
      } else {
        const assignedWhDocs = await Warehouse.find({ _id: { $in: req.user.warehouses }, company: req.user.company }).lean();
        const assignedCodes = assignedWhDocs.map(w => w.code);
        if (req.query.warehouse && req.query.warehouse !== 'all') {
          if (!assignedCodes.includes(req.query.warehouse)) {
            return res.status(403).json({ message: 'Access denied: warehouse not in your assigned scope' });
          }
          filter.warehouse = req.query.warehouse;
        } else {
          filter.warehouse = { $in: assignedCodes };
        }
      }
      if (req.query.owner && req.query.owner !== 'all') filter.owner = req.query.owner;
    } else if (req.user.role === 'warehouse_staff') {
      const staffIdentities = [req.user.email, req.user.name].filter(Boolean);
      if (req.query.assignedOnly === 'true') {
        filter.assignee = { $in: staffIdentities };
      } else {
        // Warehouse staff sees assigned tasks and unassigned pool
        filter.$or = [
          { assignee: { $in: staffIdentities } },
          { assignee: '' },
          { assignee: null },
          { assignee: { $exists: false } }
        ];
      }
      if (req.query.owner && req.query.owner !== 'all') filter.owner = req.query.owner;
      if (req.query.warehouse && req.query.warehouse !== 'all') filter.warehouse = req.query.warehouse;
    } else {
      // admin / manager have company-wide access
      if (req.query.owner && req.query.owner !== 'all') filter.owner = req.query.owner;
      if (req.query.warehouse && req.query.warehouse !== 'all') filter.warehouse = req.query.warehouse;
    }

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

    if (req.user.role === 'office') {
      return res.status(403).json({ message: 'Office users do not have access to warehouse picking tasks' });
    }

    const item = await PickTask.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }]
    });
    if (!item) return res.status(404).json({ message: 'Pick Task not found' });

    // Role-specific scoping on individual task
    if (req.user.role === 'client_3pl') {
      const client = await Client.findOne({ _id: req.user.clientId, company: req.user.company });
      if (!client || !client.active || item.owner !== client.name) {
        return res.status(403).json({ message: 'Access denied: task belongs to another owner' });
      }
    } else if (req.user.role === 'management') {
      const assignedWhDocs = await Warehouse.find({ _id: { $in: req.user.warehouses }, company: req.user.company }).lean();
      const assignedCodes = assignedWhDocs.map(w => w.code);
      if (!assignedCodes.includes(item.warehouse)) {
        return res.status(403).json({ message: 'Access denied: task belongs to an unassigned warehouse' });
      }
    }

    res.json(item);
  } catch (err) { next(err); }
});

// ── EXECUTE & COMPLETE PICK TASK (With Owner Isolation & PDF Delivery Note) ──
router.post('/:id/complete', requireOpsRole, blockOffice, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const task = await PickTask.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { taskId: req.params.id }]
    }).session(session);

    if (!task) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Pick Task not found' });
    }

    if (task.status === 'completed') {
      await session.abortTransaction();
      session.endSession();
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
      let lineOverrideDoc = null;
      if (update && update.scannedLocation) {
        const expectedLoc = (item.sourceLocation || 'STAGING-A').trim().toUpperCase();
        const scannedLoc = String(update.scannedLocation).trim().toUpperCase();
        if (scannedLoc !== expectedLoc) {
          if (!update.overrideId) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              message: `Wrong location for SKU '${item.sku}'. Scanned: ${update.scannedLocation}. Expected: ${item.sourceLocation || 'STAGING-A'}. Location overrides require an approved LocationOverride record (overrideId).`
            });
          }

          lineOverrideDoc = await LocationOverride.findOne({
            _id: update.overrideId,
            company: req.user.company,
            taskId: task.taskId,
            taskLineId: item._id,
            status: 'APPROVED',
            overrideLocation: scannedLoc
          }).session(session);

          if (!lineOverrideDoc) {
            await session.abortTransaction();
            session.endSession();
            return res.status(403).json({
              message: `Security Rejection: No authorized, approved LocationOverride found for PickTask ${task.taskId} line ${item._id} to location '${scannedLoc}'.`
            });
          }

          if (lineOverrideDoc.warehouse !== (task.warehouse || 'MIA').toUpperCase()) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              message: `Warehouse mismatch on pick override: Override is for warehouse '${lineOverrideDoc.warehouse}', but task is in '${task.warehouse}'.`
            });
          }

          item.originalSourceLocation = expectedLoc;
          item.executedLocation = scannedLoc;
          item.overrideId = lineOverrideDoc._id;
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

      const binCode = (update && update.scannedLocation ? String(update.scannedLocation).trim().toUpperCase() : null) || update?.sourceLocation || item.sourceLocation || 'STAGING-A';

      // OWNER ISOLATION: Deduct stock ONLY from matching (company, warehouse, sku, owner, bin)
      if (actualPicked > 0) {
        const deductOwner = item.inventoryOwner || taskOwner;

        // FIFO Enforcement Block (RF-P08)
        const allEligibleBalances = await InventoryBalance.find({
          company: req.user.company,
          warehouse,
          sku: item.sku,
          owner: new RegExp(`^${deductOwner}$`, 'i'),
          $or: [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }]
        }).session(session);

        if (allEligibleBalances.length > 0) {
          // Sort to find the absolute oldest entryDate
          allEligibleBalances.sort((a, b) => new Date(a.entryDate || a.createdAt || 0).getTime() - new Date(b.entryDate || b.createdAt || 0).getTime());
          const oldestAllowed = allEligibleBalances[0];
          const oldestTime = new Date(oldestAllowed.entryDate || oldestAllowed.createdAt || 0).getTime();

          const selectedBalances = allEligibleBalances.filter(b => (b.bin || '').toUpperCase() === binCode);
          if (selectedBalances.length > 0) {
            // Sort selected descending to check the NEWEST stock in the selected bin
            selectedBalances.sort((a, b) => new Date(b.entryDate || b.createdAt || 0).getTime() - new Date(a.entryDate || a.createdAt || 0).getTime());
            const selectedTime = new Date(selectedBalances[0].entryDate || selectedBalances[0].createdAt || 0).getTime();

            // Allow 60 second margin for same-receipt batches
            if (selectedTime > oldestTime + 60000) {
              if (req.body.fifoOverride) {
                // AUTHENTICATED SERVER-SIDE IDENTITY CHECK (RF-P08 Blocker #1 Fix)
                const authenticatedUser = req.user;
                if (!authenticatedUser || !['manager', 'admin'].includes((authenticatedUser.role || '').toLowerCase())) {
                  await session.abortTransaction();
                  session.endSession();
                  return res.status(403).json({ message: `FIFO Override rejected: Authenticated user is not an authorized manager/supervisor.` });
                }

                // Compatibility check if frontend still sends supervisorId:
                if (req.body.fifoOverride.supervisorId && String(req.body.fifoOverride.supervisorId) !== String(authenticatedUser._id)) {
                  await session.abortTransaction();
                  session.endSession();
                  return res.status(403).json({ message: `FIFO Override rejected: Provided supervisorId does not match the authenticated session.` });
                }

                if (!req.body.fifoOverride.reason || String(req.body.fifoOverride.reason).trim() === '') {
                  await session.abortTransaction();
                  session.endSession();
                  return res.status(400).json({ message: `FIFO Override rejected: Mandatory reason is missing or empty.` });
                }

                const supervisor = authenticatedUser;
                await InventoryTransaction.create([{
                  transactionId: 'FIFO-OVR-' + Date.now(),
                  type: 'FIFO_OVERRIDE_AUDIT',
                  sku: item.sku,
                  warehouse,
                  bin: binCode,
                  qty: actualPicked,
                  owner: deductOwner,
                  ownerType: 'COMPANY',
                  referenceId: task.taskId,
                  user: operator,
                  company: req.user.company,
                  metadata: {
                    supervisorId: supervisor._id,
                    supervisorName: supervisor.name,
                    reason: req.body.fifoOverride.reason,
                    oldestEligibleBin: oldestAllowed.bin,
                    oldestEligibleDate: new Date(oldestTime),
                    selectedDate: new Date(selectedTime)
                  }
                }], { session });
              } else {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                  message: `FIFO Violation: Older stock exists in bin ${oldestAllowed.bin}. You must pick the oldest stock first.`
                });
              }
            }
          }
        }

        // Use the real inventory owner stored at pick-task-creation time, fallback to taskOwner
        const binBalances = await InventoryBalance.find({ sku: item.sku, bin: binCode, company: req.user.company }).session(session);
        let balances = binBalances.filter(b => {
          if (!deductOwner) return true;
          const tO = deductOwner.toLowerCase().trim();
          const bO = (b.owner || '').toLowerCase().trim();
          return tO === bO;
        });

        // Fallback for B2C consumer orders where end-consumer name is not the 3PL stock depositor
        if (balances.length === 0 && binBalances.length > 0) {
          balances = binBalances.filter(b => (b.qtyReserved || 0) > 0);
        }

        const totalBinStock = balances.reduce((sum, b) => sum + (b.qtyReserved || 0), 0);

        if (balances.length === 0 || totalBinStock < actualPicked) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            message: `Owner Stock Isolation Failure: Insufficient reserved stock for SKU '${item.sku}' under Owner '${deductOwner}' at bin '${binCode}'. Reserved: ${totalBinStock}, Pick requested: ${actualPicked}.`
          });
        }

        // Deduct actualPicked across balance records for this bin (from qtyReserved!)
        let remainingToDeduct = actualPicked;
        let finalOwnerType = 'UNKNOWN';
        for (const bal of balances) {
          if (remainingToDeduct <= 0) break;
          const availHere = bal.qtyReserved || 0;
          if (availHere <= 0) continue;

          finalOwnerType = bal.ownerType || 'UNKNOWN';

          const deductFromThis = Math.min(availHere, remainingToDeduct);

          await InventoryBalance.findOneAndUpdate(
            { _id: bal._id },
            {
              $inc: {
                qtyReserved: -deductFromThis
              }
            },
            { session }
          );
          remainingToDeduct -= deductFromThis;
        }

        // Decrement Product.qty_reserved (zero double-decrement on qty_available!)
        await Product.findOneAndUpdate(
          { sku: item.sku, company: req.user.company },
          { $inc: { qty_reserved: -actualPicked } },
          { session }
        );

        // D-03: If location stock reaches 0, update Location.status to AVAILABLE (Libre)
        const remainingBalancesInBin = await InventoryBalance.find({
          company: req.user.company,
          warehouse,
          bin: binCode
        }).session(session);

        const totalBinQty = remainingBalancesInBin.reduce((sum, b) => {
          return sum + (b.qtyAvailable || 0) + (b.qtyReserved || 0) + (b.qtyQuarantine || 0) + (b.qtyAwaitingPutaway || 0);
        }, 0);

        if (totalBinQty <= 0) {
          await Location.findOneAndUpdate(
            { company: req.user.company, code: binCode },
            { $set: { status: 'AVAILABLE', qty: 0, currentUnits: 0 } },
            { session }
          );
        }

        // Record Inventory Transaction
        const txnId = 'TXN-PICK-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
        await InventoryTransaction.create([{
          transactionId: txnId,
          type: 'PICK_EXECUTE',
          sku: item.sku,
          owner: taskOwner,
          ownerType: finalOwnerType,
          warehouse,
          qty: actualPicked,
          bin: binCode,
          referenceId: task.taskId,
          user: operator,
          timestamp: new Date(),
          company: req.user.company
        }], { session });

        // Save the correct ownerType to the pick task line for downstream COGS accounting
        item.ownerType = finalOwnerType;
      }
    }

    // Update Task Status
    task.totalPickedQty = totalPicked;
    task.totalShortfallQty = totalShortfall;
    task.status = hasShortfall ? 'partially_picked' : 'completed';
    task.completedAt = new Date();
    task.completedBy = operator;

    // Generate Outbound Delivery Note Document & PDF
    const order = await Order.findOne({ orderId: task.orderId, company: req.user.company }).session(session);

    let dnCounter = await Counter.findOneAndUpdate(
      { _id: `outbound_delivery_note_${req.user.company}`, company: req.user.company },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true, session }
    );
    let dnNumber = `DN-2026-${String(dnCounter.seq).padStart(6, '0')}`;
    let existingDoc = await Document.findOne({ documentNumber: dnNumber, company: req.user.company }).session(session);
    while (existingDoc) {
      dnCounter = await Counter.findOneAndUpdate(
        { _id: `outbound_delivery_note_${req.user.company}`, company: req.user.company },
        { $inc: { seq: 1 } },
        { new: true, session }
      );
      dnNumber = `DN-2026-${String(dnCounter.seq).padStart(6, '0')}`;
      existingDoc = await Document.findOne({ documentNumber: dnNumber, company: req.user.company }).session(session);
    }

    const pdfBuffer = await generatePickDeliveryNotePDFBuffer(task, order, dnNumber, req.user.company, operator);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUri = `data:application/pdf;base64,${pdfBase64}`;

    const docRecords = await Document.create([{
      documentNumber: dnNumber,
      type: 'OUTBOUND_DELIVERY_NOTE',
      asnId: task.orderId,
      asnNumber: task.orderId,
      poNumber: order?.po_reference || task.orderId,
      supplier: order?.customer || task.customer || 'Internal Transfer',
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
    }], { session });

    const docRecord = docRecords[0];

    task.deliveryNoteNumber = dnNumber;
    task.deliveryNoteId = docRecord._id;
    await task.save({ session });

    // Idempotent PackTask Generation (SKIP for Transfers)
    if (task.orderType !== 'TRANSFER') {
      let packTask = await PackTask.findOne({ packId: task.taskId, company: req.user.company }).session(session);
      if (!packTask && totalPicked > 0) {
        packTask = await PackTask.create([{
          packId: task.taskId, // Maps 1:1 with PickTask
          order: task.orderId,
          customer: order?.customer || task.customer,
          items: totalPicked,
          picked: totalPicked,
          station: 'PACK-01',
          priority: task.priority || 'normal',
          status: 'pending',
          packItems: task.items.filter(i => i.pickedQty > 0).map(i => ({
            sku: i.sku,
            product: i.productName,
            qty: i.pickedQty,
            scanned: 0,
            verified: false
          })),
          company: req.user.company
        }], { session });
      }
    } else {
      // Phase 6 Invariant: For Transfers, add to destination warehouse IN-TRANSIT bin as qtyAwaitingPutaway
      const transferDoc = await mongoose.model('Transfer').findOne({ transferId: task.orderId, company: req.user.company }).session(session);
      if (transferDoc && totalPicked > 0) {
        for (const item of task.items) {
          if (item.pickedQty > 0) {
            await InventoryBalance.findOneAndUpdate(
              { company: req.user.company, warehouse: transferDoc.to_wh, sku: item.sku, owner: taskOwner, bin: 'IN-TRANSIT', lotNumber: 'DEFAULT-LOT' },
              { $inc: { qtyAwaitingPutaway: item.pickedQty } },
              { upsert: true, new: true, session }
            );
          }
        }
      }
    }

    // Update Order status to 'READY FOR SHIPPING' (or 'processing' if partial)
    if (order) {
      order.status = hasShortfall ? 'processing' : 'READY FOR SHIPPING';
      order.delivery_note_number = dnNumber;
      order.delivery_note_generated_at = new Date();
      await order.save({ session });
    }

    // Activity Log & Notification
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now(),
      user: operator,
      role: 'warehouse_staff',
      action: 'PICK_COMPLETED',
      module: 'PICKING',
      detail: `Completed Pick Task ${task.taskId} for Order ${task.orderId}. Delivery Note ${dnNumber} generated. Picked: ${totalPicked}/${task.totalOrderedQty} units.`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.json({
      task,
      deliveryNoteNumber: dnNumber,
      pdfUrl: `/api/v1/documents/dn/${dnNumber}/pdf`
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// DELETE
router.delete('/:id', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }
    const item = await PickTask.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!item) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Pick Task not found' });
    }

    if (item.status !== 'pending' && item.status !== 'in_progress') {
       await session.abortTransaction();
       session.endSession();
       return res.status(400).json({ message: 'Cannot delete a pick task that is already completed or partially picked.' });
    }

    // Restore InventoryBalance and Product.qty_available
    const taskOwner = item.owner || 'Default Owner';
    for (const line of item.items) {
      const releaseQty = line.orderedQty - line.pickedQty;
      if (releaseQty > 0) {
        // Find reserved balances in that bin
        const deductOwner = line.inventoryOwner || taskOwner;
        const binBalances = await InventoryBalance.find({ sku: line.sku, bin: line.sourceLocation, company: req.user.company }).session(session);
        let balances = binBalances.filter(b => {
          if (!deductOwner) return true;
          return deductOwner.toLowerCase().trim() === (b.owner || '').toLowerCase().trim();
        });
        if (balances.length === 0 && binBalances.length > 0) balances = binBalances;

        let remainingToRestore = releaseQty;
        for (const bal of balances) {
          if (remainingToRestore <= 0) break;
          const availHere = bal.qtyReserved || 0;
          if (availHere <= 0) continue;
          const restoreFromThis = Math.min(availHere, remainingToRestore);

          await InventoryBalance.findOneAndUpdate(
            { _id: bal._id },
            { $inc: { qtyAvailable: restoreFromThis, qtyReserved: -restoreFromThis } },
            { session }
          );
          remainingToRestore -= restoreFromThis;
        }

        // Restore Product aggregate
        await Product.findOneAndUpdate(
          { sku: line.sku, company: req.user.company },
          { $inc: { qty_available: releaseQty } },
          { session }
        );
      }
    }

    await PickTask.deleteOne({ _id: item._id }).session(session);
    await session.commitTransaction();
    session.endSession();
    res.json({ message: 'Deleted successfully and reservation restored' });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

export default router;
