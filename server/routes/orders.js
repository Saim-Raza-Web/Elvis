import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Order from '../models/Order.js';
import Counter from '../models/Counter.js';
import PickTask from '../models/PickTask.js';
import Notification from '../models/Notification.js';
import ActivityLog from '../models/ActivityLog.js';

const router = express.Router();
router.use(protect);

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
    if (!delivery_terms) errors.push('Delivery terms are required for B2B orders.');
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

// STATUS UPDATE (PATCH) — lightweight status-only change
router.patch('/:id/status', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { status } = req.body;
    const allowed = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }
    const item = await Order.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      { status },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Order not found' });

    await logActivity(req, 'STATUS_CHANGE', 'Orders', `Order ${item.orderId} status changed to ${status}`);

    res.json(item);
  } catch (err) { next(err); }
});

// RELEASE to Fulfillment
router.post('/:id/release', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const order = await Order.findOne({ _id: req.params.id, company: req.user.company });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.status !== 'pending') {
      return res.status(400).json({ message: `Cannot release order with status "${order.status}". Only pending orders can be released.` });
    }

    order.status = 'processing';
    await order.save();

    // Generate PickTask
    const pickTaskId = 'PCK-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    await PickTask.create({
      taskId: pickTaskId,
      order: order.orderId,
      priority: order.order_type === 'B2B' ? 'high' : 'normal',
      status: 'ready',
      items: order.items || 1,
      picked: 0,
      zone: 'Zone-A',
      company: req.user.company,
    });

    // Notification
    Notification.create({
      company: req.user.company,
      kind: 'info',
      title: 'Order Released to Fulfillment',
      body: `Order ${order.orderId} has been released to picking (${pickTaskId})`,
    }).catch(() => {});

    await logActivity(req, 'RELEASE', 'Orders', `Released order ${order.orderId} to fulfillment — pick task ${pickTaskId} created`);

    res.json(order);
  } catch (err) { next(err); }
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
