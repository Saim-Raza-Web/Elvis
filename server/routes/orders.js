import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Model from '../models/Order.js';
import PickTask from '../models/PickTask.js';
import Notification from '../models/Notification.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['orderId', 'customer', 'email'],
      exact: { status: 'status' },
    });
    const result = await paginateQuery(Model, filter, req, { populate: 'store_id' });
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
    if (!data.orderId) {
      data.orderId = 'ORD-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    }
    const item = await Model.create(data);
    
    // Emit notification
    await Notification.create({
      company: req.user.company,
      kind: 'info',
      title: 'New Order Created',
      body: `Order ${item.orderId} was created for ${item.customer}`
    });

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// RELEASE to Fulfillment
router.post('/:id/release', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const order = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      { status: 'processing' }, 
      { new: true }
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Generate PickTask
    const pickTaskId = 'PCK-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    await PickTask.create({
      taskId: pickTaskId,
      order: order.orderId,
      priority: 'normal',
      status: 'ready',
      items: order.items || 1,
      picked: 0,
      zone: 'Zone-A', // Default or logical mapping
      company: req.user.company
    });

    res.json(order);
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
