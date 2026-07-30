import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/PickTask.js';
import PickBatch from '../models/PickBatch.js';
import Order from '../models/Order.js';
import PackTask from '../models/PackTask.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');

// GET all batches
router.get('/batches', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const result = await paginateQuery(PickBatch, { company: req.user.company }, req);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// CREATE a batch
router.post('/batches', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const data = { ...req.body, company: req.user.company };
    const batchId = 'BCH-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    data.batchId = batchId;
    const item = await PickBatch.create(data);
    
    // Also update all passed picktasks or orders to in_progress/batched if needed
    // Assuming data.orders contains orderIds
    // This is optional for now; we just create the batch record.

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE a batch (start, complete)
router.put('/batches/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await PickBatch.findOneAndUpdate(
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
      req.body.started = new Date();
    }
    if (!wasCompleted && isCompleted) {
      req.body.completedAt = new Date();
      // Simulate random errors if not explicitly sent (for realistic metrics demo)
      if (req.body.errors === undefined) {
        req.body.errors = Math.random() > 0.85 ? Math.floor(Math.random() * 3) + 1 : 0;
      }
    }

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );

    if (!wasCompleted && isCompleted) {
      const order = await Order.findOneAndUpdate(
        { orderId: item.order, company: req.user.company },
        { status: 'picked' },
        { new: true }
      );

      const packTaskId = 'PAK-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
      await PackTask.create({
        packId: packTaskId,
        order: item.order,
        customer: order ? order.customer : 'Unknown',
        items: item.items,
        picked: item.picked,
        station: 'Station-1',
        priority: item.priority || 'normal',
        status: 'ready',
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
