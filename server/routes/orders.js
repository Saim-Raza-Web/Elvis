import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Order from '../models/Order.js';
import Counter from '../models/Counter.js';
import PickTask from '../models/PickTask.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Notification from '../models/Notification.js';
import ActivityLog from '../models/ActivityLog.js';
import { evaluateOrderForProcurement } from '../services/procurement.service.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { pickingEngine } from '../services/pickingEngine.js';
import mongoose from 'mongoose';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

// ── Helpers ──────────────────────────────────────────────────

/** Generate sequential order ID: ORD-000001, ORD-000002... */
async function nextOrderId(company) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'order', company },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `ORD-${String(counter.seq).padStart(6, '0')}`;
}

/** Log activity (non-blocking — errors are swallowed) */
async function logActivity(req, action, module, detail) {
  try {
    const logId = 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    await ActivityLog.create({
      logId,
      user: req.user?.email || req.user?.name || 'system',
      role: req.user?.role || 'unknown',
      action,
      module,
      detail,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
      timestamp: new Date(),
      company: req.user?.company,
    });
  } catch (_) {
    // Non-fatal — never block the request
  }
}

/** Server-side validation for order payloads */
function validateOrderPayload(body) {
  const errors = [];
  const { order_type, customer, email, product_lines, delivery_address,
          company_name, vat_number, contact_person, pallet_count,
          shipment_weight, delivery_terms, po_reference } = body;

  if (!customer || !String(customer).trim()) errors.push('Customer name is required.');

  if (order_type === 'B2C' || !order_type) {
    if (!email || !String(email).trim()) errors.push('Email is required for B2C orders.');
  }

  // Product lines
  if (!Array.isArray(product_lines) || product_lines.length === 0) {
    errors.push('At least one product line is required.');
  } else {
    const valid = product_lines.filter(l => l.sku && l.product_name && Number(l.qty) > 0 && Number(l.unit_price) >= 0);
    if (valid.length === 0) errors.push('At least one valid product line (SKU, name, qty > 0) is required.');
    product_lines.forEach((l, i) => {
      if (Number(l.qty) <= 0) errors.push(`Line ${i + 1}: quantity must be greater than 0.`);
      if (Number(l.unit_price) < 0) errors.push(`Line ${i + 1}: unit price cannot be negative.`);
    });
  }

  // Delivery address
  const addr = delivery_address || {};
  if (!addr.street || !addr.city || !addr.postcode || !addr.country) {
    errors.push('Complete delivery address (street, city, postcode, country) is required.');
  }

  // B2B-specific
  if (order_type === 'B2B') {
    if (!company_name || !String(company_name).trim()) errors.push('Company name is required for B2B orders.');
    if (!vat_number || !String(vat_number).trim()) errors.push('VAT number is required for B2B orders.');
    if (!contact_person || !String(contact_person).trim()) errors.push('Contact person is required for B2B orders.');
    if (!pallet_count || Number(pallet_count) < 1) errors.push('Pallet count must be at least 1 for B2B orders.');
    if (!shipment_weight || !String(shipment_weight).trim()) errors.push('Shipment weight is required for B2B orders.');
    if (!po_reference || !String(po_reference).trim()) errors.push('PO reference is required for B2B orders.');
  }

  return errors;
}

// ── Routes ────────────────────────────────────────────────────

// GET all (paginated)
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['orderId', 'customer', 'email', 'company_name', 'po_reference'],
      exact: { status: 'status', order_type: 'order_type' },
    });
    const result = await paginateQuery(Order, filter, req, { populate: 'store_id' });
    res.json(result);
  } catch (err) { next(err); }
});

// GET by ID (full document)
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Order.findOne({ _id: req.params.id, company: req.user.company }).populate('store_id');
    if (!item) return res.status(404).json({ message: 'Order not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// CREATE
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    // Server-side validation
    const validationErrors = validateOrderPayload(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ message: validationErrors.join(' ') });
    }

    const data = { ...req.body, company: req.user.company };

    // Generate sequential orderId if not provided
    if (!data.orderId) {
      data.orderId = await nextOrderId(req.user.company);
    }

    // Ensure status is set to pending on create
    data.status = 'pending';

    const item = await Order.create(data);

    // Notifications (non-blocking)
    Notification.create({
      company: req.user.company,
      kind: 'info',
      title: 'New Order Created',
      body: `Order ${item.orderId} was created for ${item.customer}`,
    }).catch(() => {});

    // Activity log
    await logActivity(req, 'CREATE', 'Orders', `Created order ${item.orderId} for ${item.customer} (${item.order_type})`);

    // Async procurement evaluation (non-blocking)
    if (item.order_type === 'B2B') {
      evaluateOrderForProcurement(item._id, req.user.company).catch(err => {
        console.error('Procurement evaluation failed:', err);
      });
    }

    res.status(201).json(item);
  } catch (err) { next(err); }
});

// UPDATE — loads doc then saves so pre-save hook recalculates totals
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    // Validation (skip strict on edit — allow partial updates)
    if (req.body.product_lines !== undefined) {
      const lines = req.body.product_lines;
      if (Array.isArray(lines)) {
        for (let i = 0; i < lines.length; i++) {
          if (Number(lines[i].qty) <= 0) {
            return res.status(400).json({ message: `Line ${i + 1}: quantity must be greater than 0.` });
          }
          if (Number(lines[i].unit_price) < 0) {
            return res.status(400).json({ message: `Line ${i + 1}: unit price cannot be negative.` });
          }
        }
      }
    }

    const existing = await Order.findOne({ _id: req.params.id, company: req.user.company });
    if (!existing) return res.status(404).json({ message: 'Order not found' });

    // Merge updates — preserve orderId, company, and status unless explicitly changed
    const allowedUpdate = { ...req.body };
    delete allowedUpdate.orderId;   // orderId is immutable
    delete allowedUpdate.company;   // company is immutable
    // Only allow status update if explicitly provided; otherwise keep existing
    if (!allowedUpdate.status) allowedUpdate.status = existing.status;

    Object.assign(existing, allowedUpdate);
    const updated = await existing.save(); // triggers pre-save hook for totals

    await logActivity(req, 'UPDATE', 'Orders', `Updated order ${updated.orderId}`);

    res.json(updated);
  } catch (err) { next(err); }
});

/** Helper: Idempotent PickTask Generation for Confirmed/Released Orders */
export async function ensurePickTaskForOrder(order, userCompany, session) {
  const companyId = userCompany || order.company;
  if (!order || !order.orderId) {
    throw new Error('Invalid order document');
  }

  // FAIL if order has zero product lines!
  if (!order.product_lines || !Array.isArray(order.product_lines) || order.product_lines.length === 0) {
    throw new Error(`Cannot release order ${order.orderId} to fulfillment: Order contains 0 product lines.`);
  }

  // 1. Derive PickTask lines from Order product_lines using Phase 3 pickingEngine
  const lines = [];
  let orderRequiresUpdate = false;
  
  for (let i = 0; i < order.product_lines.length; i++) {
    const line = order.product_lines[i];
    const skuClean = (line.sku || '').trim();
    
    // Determine how much to request based on previous shortfalls
    let requestedQty = Number(line.qty) || 1;
    if (order.status === 'processing' || order.status === 'partially_fulfilled') {
      if (line.shortfallQty !== undefined && line.shortfallQty < requestedQty) {
        requestedQty = line.shortfallQty;
      }
    }
    
    if (requestedQty <= 0) continue; // Skip lines that are already fully fulfilled

    const taskOwner = (order.company_name || order.customer || 'Default Owner').trim();

    try {
      const allocationResult = await pickingEngine.evaluatePickAllocation({
        companyId,
        warehouse: order.warehouse, // Note: if warehouse is not an ObjectId here, engine might fail, but engine handles it.
        sku: skuClean,
        qtyNeeded: requestedQty,
        owner: taskOwner, // Pass owner to ensure 3PL tenant isolation!
        strategy: 'FEFO', // Default strategy, pickingEngine might override based on rules
        session
      });

      if (allocationResult.allocatedLocations.length === 0) {
        // No inventory available
        if (line.shortfallQty !== requestedQty) {
          line.shortfallQty = requestedQty;
          orderRequiresUpdate = true;
        }
      } else {
        // Engine successfully allocated across one or more bins
        for (const alloc of allocationResult.allocatedLocations) {
          lines.push({
            sku: line.sku,
            productName: line.product_name || line.sku,
            orderedQty: alloc.allocatedQty,
            pickedQty: 0,
            shortfallQty: 0, // Engine guarantees this qty is available and reserved!
            sourceLocation: alloc.location,
            inventoryOwner: alloc.owner || taskOwner,
            status: 'pending'
          });
        }
        
        // Track backorder/shortfall explicitly on the order line, without phantom task
        if (line.shortfallQty !== allocationResult.shortfallQty) {
          line.shortfallQty = allocationResult.shortfallQty;
          orderRequiresUpdate = true;
        }
      }
    } catch (err) {
      if (err.message.includes('Write conflict') || err.message.includes('Transaction') || err.code === 112) {
        throw err; // MUST rethrow concurrency errors so the transaction aborts properly!
      }
      console.error(`[PickTask Gen] Engine failure for SKU ${skuClean}:`, err.message);
      line.shortfallQty = requestedQty;
      orderRequiresUpdate = true;
    }
  }

  // Determine final status
  const allFullyFulfilled = order.product_lines.every(l => l.shortfallQty === 0);
  order.status = allFullyFulfilled ? 'processing' : 'partially_fulfilled'; // Both represent processing state, but 'partially' allows future re-release
  orderRequiresUpdate = true;

  // Update order with shortfalls if necessary
  if (orderRequiresUpdate) {
    await order.save({ session }); // Assuming order is a Mongoose document
  }

  // POLICY B compliance: If NO physical inventory was allocated, do not generate an empty PickTask.
  if (lines.length === 0) {
    console.log(`[PickTask Gen] Order ${order.orderId} resulted in 100% backorder. No PickTask created.`);
    return null;
  }

  const counter = await Counter.findOneAndUpdate(
    { _id: 'pick_task_' + companyId.toString(), company: companyId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const taskId = `PICK-2026-${String(counter.seq).padStart(6, '0')}`;

  const taskOwner = (order.company_name || order.customer || 'Default Owner').trim();
  const totalQty = lines.reduce((sum, l) => sum + l.orderedQty, 0);

  const newTask = await PickTask.create([{
    taskId,
    order: order.orderId, // Legacy order field for UI compatibility
    orderId: order.orderId,
    orderNumber: order.orderId,
    orderType: order.order_type || 'B2B',
    owner: taskOwner,
    customer: order.customer || order.company_name || 'Client',
    warehouse: order.warehouse || 'MIA',
    priority: order.order_type === 'B2B' ? 'high' : 'normal',
    status: 'pending',
    linesCount: lines.length,
    totalOrderedQty: totalQty,
    totalPickedQty: 0,
    totalShortfallQty: 0,
    items: lines,
    company: companyId
  }], { session });

  return newTask[0];
}

// STATUS UPDATE (PATCH) — lightweight status-only change
router.patch('/:id/status', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { status } = req.body;
    const allowed = ['pending', 'processing', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }
    const item = await Order.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      { status: status === 'confirmed' ? 'processing' : status },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Order not found' });

    // Auto-generate PickTask on Order Confirmation/Processing
    if (status === 'processing' || status === 'confirmed') {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        await ensurePickTaskForOrder(item, req.user.company, session);
        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    }

    await logActivity(req, 'STATUS_CHANGE', 'Orders', `Order ${item.orderId} status changed to ${status}`);

    res.json(item);
  } catch (err) { next(err); }
});

// RELEASE to Fulfillment
router.post('/:id/release', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const currentOrder = await Order.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!currentOrder) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Order not found' });
    }

    if (currentOrder.status !== 'pending' && currentOrder.status !== 'partially_fulfilled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Cannot release order with status "${currentOrder.status}". Only pending or partially fulfilled orders can be released.` });
    }

    // Atomically acquire the order using __v for strict OCC!
    const acquiredOrder = await Order.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company, __v: currentOrder.__v },
      { $inc: { __v: 1 } },
      { new: true, session }
    );

    if (!acquiredOrder) {
      await session.abortTransaction();
      session.endSession();
      // Safe to return 409 because another thread changed the order state!
      return res.status(409).json({ message: 'Conflict: Order state was modified concurrently.' });
    }

    // Idempotent PickTask Generation with OCC tracking
    const pickTask = await ensurePickTaskForOrder(acquiredOrder, req.user.company, session);

    await session.commitTransaction();
    session.endSession();

    // Notification
    if (pickTask) {
      Notification.create({
        company: req.user.company,
        kind: 'info',
        title: 'Order Released to Fulfillment',
        body: `Order ${acquiredOrder.orderId} has been released to picking (${pickTask.taskId})`,
      }).catch(() => {});
      await logActivity(req, 'RELEASE', 'Orders', `Released order ${acquiredOrder.orderId} to fulfillment — pick task ${pickTask.taskId} ready`);
    } else {
      await logActivity(req, 'RELEASE', 'Orders', `Released order ${acquiredOrder.orderId} to fulfillment — 100% backordered`);
    }

    res.json({ message: 'Order released successfully', order: acquiredOrder, pickTask });
  } catch (err) { 
    await session.abortTransaction();
    session.endSession();
    
    // Catch WriteConflict or Aborted Transaction and return 409 Gracefully
    if (err.message.includes('Write conflict') || err.message.includes('Transaction') || err.code === 112) {
      return res.status(409).json({ message: 'Conflict: Order state was modified concurrently.' });
    }
    
    next(err); 
  }
});

// DELETE
router.delete('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Order.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Order not found' });

    await logActivity(req, 'DELETE', 'Orders', `Deleted order ${item.orderId} (${item.customer})`);

    res.json({ message: 'Order deleted successfully' });
  } catch (err) { next(err); }
});

export default router;
