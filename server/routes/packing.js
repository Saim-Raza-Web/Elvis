import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/PackTask.js';
import Order from '../models/Order.js';
import Shipment from '../models/Shipment.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const result = await paginateQuery(Model, { company: req.user.company }, req);
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
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const wasCompleted = existing.status === 'completed';
    const isCompleted = req.body.status === 'completed';

    if (existing.status !== 'in_progress' && req.body.status === 'in_progress') {
      req.body.startedAt = new Date();
    }
    if (!wasCompleted && isCompleted) {
      req.body.completedAt = new Date();
    }

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );

    if (!wasCompleted && isCompleted) {
      const order = await Order.findOneAndUpdate(
        { orderId: item.order, company: req.user.company },
        { status: 'packed' },
        { new: true }
      );

      const shipmentId = 'SHP-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
      await Shipment.create({
        shipmentId: shipmentId,
        order: item.order,
        customer: order ? order.customer : item.customer,
        carrier: 'Pending',
        tracking: 'Pending',
        origin: 'Warehouse',
        destination: 'Customer',
        status: 'pending',
        weight: item.weight || '1.0kg',
        company: req.user.company
      });
    }

    res.json(item);
  } catch (err) {
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
