import express from 'express';
import mongoose from 'mongoose';
import PutawayTask from '../models/PutawayTask.js';
import PickTask from '../models/PickTask.js';
import WarehouseTask from '../models/WarehouseTask.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';

const router = express.Router();
router.use(validateWarehouse);

// ── Status Normalization ──
const VALID_NORMALIZED_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'];

function normalizeStatus(sourceModel, nativeStatus) {
  const s = String(nativeStatus || '').toLowerCase();
  if (sourceModel === 'PutawayTask') {
    if (s === 'pending') return 'pending';
    if (s === 'assigned' || s === 'in_progress') return 'in_progress';
    if (s === 'completed') return 'completed';
    if (s === 'cancelled') return 'cancelled';
  } else if (sourceModel === 'PickTask') {
    if (s === 'pending') return 'pending';
    if (s === 'assigned' || s === 'in_progress' || s === 'partially_picked') return 'in_progress';
    if (s === 'completed') return 'completed';
    if (s === 'cancelled') return 'cancelled';
    if (s === 'blocked') return 'blocked';
  } else if (sourceModel === 'WarehouseTask') {
    if (s === 'pending') return 'pending';
    if (s === 'assigned' || s === 'in_progress') return 'in_progress';
    if (s === 'completed') return 'completed';
    if (s === 'cancelled' || s === 'timed_out') return 'cancelled';
  }
  return 'pending';
}

// ── Priority Normalization ──
const VALID_NORMALIZED_PRIORITIES = ['urgent', 'high', 'normal', 'low'];

function normalizePriority(sourceModel, nativePriority) {
  if (sourceModel === 'WarehouseTask') {
    const num = Number(nativePriority);
    if (num === 1) return 'urgent';
    if (num === 2) return 'high';
    if (num === 3) return 'normal';
    if (num === 4) return 'low';
  }
  const p = String(nativePriority || '').toLowerCase();
  if (p === 'urgent' || p === 'critical') return 'urgent';
  if (p === 'high') return 'high';
  if (p === 'normal' || p === 'medium') return 'normal';
  if (p === 'low') return 'low';
  return 'normal';
}

// ── OwnerType Normalization ──
function normalizeOwnerType(raw) {
  const o = String(raw || '').toUpperCase();
  if (o === 'COMPANY') return 'COMPANY';
  if (o === 'CUSTOMER') return 'CUSTOMER';
  return 'UNKNOWN';
}

// ── Transfer Detection ──
function isTransferPutaway(t) {
  return Boolean(
    t.fromLocation === 'IN-TRANSIT' ||
    t.supplier === 'Internal Transfer' ||
    (t.asnId && String(t.asnId).startsWith('TRF-')) ||
    (t.asnNumber && String(t.asnNumber).startsWith('TRF-'))
  );
}

function isTransferPick(t) {
  return Boolean(
    t.orderType === 'TRANSFER' ||
    (t.orderId && String(t.orderId).startsWith('TRF-')) ||
    (t.orderNumber && String(t.orderNumber).startsWith('TRF-'))
  );
}

// ── Model Normalizers ──
function normalizePutawayTask(t) {
  return {
    id: String(t._id),
    taskId: t.taskId || String(t._id),
    taskType: isTransferPutaway(t) ? 'transfer' : 'putaway',
    sourceModel: 'PutawayTask',
    status: normalizeStatus('PutawayTask', t.status),
    company: t.company,
    warehouse: t.warehouse || 'MIA',
    sku: t.sku || '',
    quantity: Number(t.qty || 0),
    source: t.fromLocation || 'Z-RECEIVING',
    destination: t.toLocation || t.destinationBin || 'RECEIVING-BUFFER',
    owner: t.owner || 'Default Owner',
    ownerType: normalizeOwnerType(t.ownerType),
    lot: t.lotNumber || t.batchNumber || '',
    priority: normalizePriority('PutawayTask', t.priority),
    assignedTo: t.assignedTo || '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  };
}

function normalizePickTask(t) {
  const items = Array.isArray(t.items) ? t.items : [];
  const primaryItem = items[0] || {};
  const skuString = items.length > 1
    ? items.map(i => i.sku).filter(Boolean).join(', ')
    : (primaryItem.sku || '');
  const qtyNum = t.totalOrderedQty !== undefined && t.totalOrderedQty !== null
    ? Number(t.totalOrderedQty)
    : items.reduce((acc, i) => acc + Number(i.orderedQty || 0), 0);

  const transfer = isTransferPick(t);

  return {
    id: String(t._id),
    taskId: t.taskId || String(t._id),
    taskType: transfer ? 'transfer' : 'picking',
    sourceModel: 'PickTask',
    status: normalizeStatus('PickTask', t.status),
    company: t.company,
    warehouse: t.warehouse || 'MIA',
    sku: skuString,
    quantity: qtyNum,
    source: primaryItem.sourceLocation || 'STAGING-A',
    destination: transfer ? 'STAGING-OUT' : 'PACKING-STATION',
    owner: t.owner || primaryItem.inventoryOwner || 'Default Owner',
    ownerType: normalizeOwnerType(primaryItem.ownerType),
    lot: '',
    priority: normalizePriority('PickTask', t.priority),
    assignedTo: t.assignee || t.completedBy || '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  };
}

function normalizeWarehouseTask(t) {
  return {
    id: String(t._id),
    taskId: t.taskId || String(t._id),
    taskType: 'replenishment',
    sourceModel: 'WarehouseTask',
    status: normalizeStatus('WarehouseTask', t.status),
    company: t.company,
    warehouse: t.warehouse || 'MIA',
    sku: t.sku_code || (t.sku ? String(t.sku) : ''),
    quantity: Number(t.qty || 0),
    source: t.source_bin || '',
    destination: t.destination_bin || '',
    owner: t.owner || 'Default Owner',
    ownerType: normalizeOwnerType(t.ownerType),
    lot: t.lot_number || '',
    priority: normalizePriority('WarehouseTask', t.priority),
    assignedTo: t.assigned_to ? String(t.assigned_to) : '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
  };
}

// ── GET /api/v1/tasks — Unified Tasks Read Facade ──
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const companyId = req.user.company;

    // 1. Pagination Validation
    const rawPage = req.query.page !== undefined ? Number(req.query.page) : 1;
    const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : 25;

    if (!Number.isInteger(rawPage) || rawPage < 1) {
      return res.status(400).json({ message: 'Page must be an integer >= 1' });
    }
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
      return res.status(400).json({ message: 'Limit must be an integer between 1 and 100' });
    }

    const page = rawPage;
    const limit = rawLimit;

    // 2. Filter Validations
    const { status, taskType, priority } = req.query;

    if (status && !VALID_NORMALIZED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status '${status}'. Allowed: ${VALID_NORMALIZED_STATUSES.join(', ')}`
      });
    }

    const VALID_TASK_TYPES = ['putaway', 'picking', 'replenishment', 'transfer'];
    if (taskType && !VALID_TASK_TYPES.includes(taskType)) {
      return res.status(400).json({
        message: `Invalid taskType '${taskType}'. Allowed: ${VALID_TASK_TYPES.join(', ')}`
      });
    }

    if (priority && !VALID_NORMALIZED_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        message: `Invalid priority '${priority}'. Allowed: ${VALID_NORMALIZED_PRIORITIES.join(', ')}`
      });
    }

    // 3. Warehouse Scope Resolution
    let warehouseCode = null;
    if (req.context && req.context.warehouse && !req.context.warehouse.invalid) {
      warehouseCode = req.context.warehouse.code;
    } else if (req.query.warehouse) {
      warehouseCode = String(req.query.warehouse).trim();
    }

    // 4. Determine Active Collections based on taskType
    const queryPutaway = !taskType || taskType === 'putaway' || taskType === 'transfer';
    const queryPick = !taskType || taskType === 'picking' || taskType === 'transfer';
    const queryReplenishment = !taskType || taskType === 'replenishment';

    // 5. Build Native Model Filters
    const maxFetch = page * limit;

    const promises = [];

    // --- PutawayTask Query ---
    if (queryPutaway) {
      const putFilter = { company: companyId };
      if (warehouseCode) putFilter.warehouse = warehouseCode;

      // Transfer segregation
      if (taskType === 'putaway') {
        putFilter.fromLocation = { $ne: 'IN-TRANSIT' };
        putFilter.supplier = { $ne: 'Internal Transfer' };
      } else if (taskType === 'transfer') {
        putFilter.$or = [
          { fromLocation: 'IN-TRANSIT' },
          { supplier: 'Internal Transfer' },
          { asnId: /^TRF-/i }
        ];
      }

      // Status filter
      if (status) {
        if (status === 'pending') putFilter.status = 'pending';
        else if (status === 'in_progress') putFilter.status = { $in: ['assigned', 'in_progress'] };
        else if (status === 'completed') putFilter.status = 'completed';
        else if (status === 'cancelled') putFilter.status = 'cancelled';
        else if (status === 'blocked') putFilter.status = '__NONE__'; // Putaway has no blocked
      }

      // Priority filter
      if (priority) {
        if (priority === 'urgent') putFilter.priority = 'urgent';
        else if (priority === 'high') putFilter.priority = 'high';
        else if (priority === 'normal') putFilter.priority = 'normal';
        else if (priority === 'low') putFilter.priority = '__NONE__';
      }

      promises.push(
        PutawayTask.find(putFilter).sort({ createdAt: -1 }).limit(maxFetch).lean(),
        PutawayTask.countDocuments(putFilter)
      );
    } else {
      promises.push(Promise.resolve([]), Promise.resolve(0));
    }

    // --- PickTask Query ---
    if (queryPick) {
      const pickFilter = { company: companyId };
      if (warehouseCode) pickFilter.warehouse = warehouseCode;

      // Transfer segregation
      if (taskType === 'picking') {
        pickFilter.orderType = { $ne: 'TRANSFER' };
      } else if (taskType === 'transfer') {
        pickFilter.$or = [
          { orderType: 'TRANSFER' },
          { orderId: /^TRF-/i }
        ];
      }

      // Status filter
      if (status) {
        if (status === 'pending') pickFilter.status = 'pending';
        else if (status === 'in_progress') pickFilter.status = { $in: ['assigned', 'in_progress', 'partially_picked'] };
        else if (status === 'completed') pickFilter.status = 'completed';
        else if (status === 'cancelled') pickFilter.status = 'cancelled';
        else if (status === 'blocked') pickFilter.status = 'blocked';
      }

      // Priority filter
      if (priority) {
        if (priority === 'urgent') pickFilter.priority = 'urgent';
        else if (priority === 'high') pickFilter.priority = 'high';
        else if (priority === 'normal') pickFilter.priority = 'normal';
        else if (priority === 'low') pickFilter.priority = 'low';
      }

      promises.push(
        PickTask.find(pickFilter).sort({ createdAt: -1 }).limit(maxFetch).lean(),
        PickTask.countDocuments(pickFilter)
      );
    } else {
      promises.push(Promise.resolve([]), Promise.resolve(0));
    }

    // --- WarehouseTask (Replenishment) Query ---
    if (queryReplenishment) {
      const repFilter = { company: companyId, task_type: 'replenishment' };
      if (warehouseCode) repFilter.warehouse = warehouseCode;

      // Status filter
      if (status) {
        if (status === 'pending') repFilter.status = 'pending';
        else if (status === 'in_progress') repFilter.status = { $in: ['assigned', 'in_progress'] };
        else if (status === 'completed') repFilter.status = 'completed';
        else if (status === 'cancelled') repFilter.status = { $in: ['cancelled', 'timed_out'] };
        else if (status === 'blocked') repFilter.status = '__NONE__';
      }

      // Priority filter
      if (priority) {
        if (priority === 'urgent') repFilter.priority = 1;
        else if (priority === 'high') repFilter.priority = 2;
        else if (priority === 'normal') repFilter.priority = 3;
        else if (priority === 'low') repFilter.priority = 4;
      }

      promises.push(
        WarehouseTask.find(repFilter).sort({ createdAt: -1 }).limit(maxFetch).lean(),
        WarehouseTask.countDocuments(repFilter)
      );
    } else {
      promises.push(Promise.resolve([]), Promise.resolve(0));
    }

    // 6. Concurrent Read Execution
    const [putTasks, putCount, pickTasks, pickCount, repTasks, repCount] = await Promise.all(promises);

    // 7. Normalization into Unified Schema
    const normalized = [];

    for (const pt of putTasks) {
      const item = normalizePutawayTask(pt);
      // Double check filter invariant
      if (!taskType || item.taskType === taskType) {
        normalized.push(item);
      }
    }

    for (const pk of pickTasks) {
      const item = normalizePickTask(pk);
      if (!taskType || item.taskType === taskType) {
        normalized.push(item);
      }
    }

    for (const wt of repTasks) {
      const item = normalizeWarehouseTask(wt);
      if (!taskType || item.taskType === taskType) {
        normalized.push(item);
      }
    }

    // 8. Deterministic Ordering
    // Primary: createdAt DESC. Secondary: taskId ASC. Tertiary: id ASC.
    normalized.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      const taskCmp = (a.taskId || '').localeCompare(b.taskId || '');
      if (taskCmp !== 0) return taskCmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    // 9. Total Calculation and Slicing
    const total = putCount + pickCount + repCount;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const skip = (page - 1) * limit;
    const pagedData = normalized.slice(skip, skip + limit);

    return res.json({
      data: pagedData,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/tasks/:id — Lookup Unified Task by ID ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { id } = req.params;
    const companyId = req.user.company;
    const isValidObjectId = mongoose.Types.ObjectId.isValid(id);

    // 1. Try PutawayTask
    const putQuery = { company: companyId };
    if (isValidObjectId) {
      putQuery.$or = [{ _id: id }, { taskId: id }];
    } else {
      putQuery.taskId = id;
    }
    const putTask = await PutawayTask.findOne(putQuery).lean();
    if (putTask) {
      return res.json({ data: normalizePutawayTask(putTask) });
    }

    // 2. Try PickTask
    const pickQuery = { company: companyId };
    if (isValidObjectId) {
      pickQuery.$or = [{ _id: id }, { taskId: id }];
    } else {
      pickQuery.taskId = id;
    }
    const pickTask = await PickTask.findOne(pickQuery).lean();
    if (pickTask) {
      return res.json({ data: normalizePickTask(pickTask) });
    }

    // 3. Try WarehouseTask
    const repQuery = { company: companyId, task_type: 'replenishment' };
    if (isValidObjectId) {
      repQuery.$or = [{ _id: id }, { taskId: id }];
    } else {
      repQuery.taskId = id;
    }
    const repTask = await WarehouseTask.findOne(repQuery).lean();
    if (repTask) {
      return res.json({ data: normalizeWarehouseTask(repTask) });
    }

    // 4. Not Found (or cross-tenant attempt)
    return res.status(404).json({ message: `Task not found: ${id}` });
  } catch (err) {
    next(err);
  }
});

export default router;
