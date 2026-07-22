import express from 'express';
import { protect } from '../middleware/auth.js';
import Model from '../models/Shipment.js';
import Order from '../models/Order.js';
import ActivityLog from '../models/ActivityLog.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const items = await Model.find({ company: req.user.company });
    res.json(items);
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
router.post('/', async (req, res, next) => {
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
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const wasShipped = existing.status === 'shipped' || existing.status === 'in_transit';
    const isShipped = req.body.status === 'shipped' || req.body.status === 'in_transit';

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );

    if (!wasShipped && isShipped) {
      await Order.findOneAndUpdate(
        { orderId: item.order, company: req.user.company },
        { status: 'shipped' }
      );

      await ActivityLog.create({
        user: req.user.name,
        action: 'Shipped order',
        target: item.order,
        company: req.user.company
      });
    }

    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
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
