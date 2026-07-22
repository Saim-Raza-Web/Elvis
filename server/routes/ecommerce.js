import express from 'express';
import { protect } from '../middleware/auth.js';
import Model from '../models/EcommerceChannel.js';
import Order from '../models/Order.js';

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

// SYNC
router.post('/:id/sync', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const channel = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      { status: 'syncing' },
      { new: true }
    );
    if (!channel) return res.status(404).json({ message: 'Channel not found' });

    // Generate 1-3 random orders to simulate fetching
    const numOrders = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numOrders; i++) {
      const orderId = 'ORD-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
      await Order.create({
        orderId,
        customer: `Customer ${Math.floor(Math.random() * 1000)}`,
        email: `customer${Math.floor(Math.random() * 1000)}@example.com`,
        channel: channel.platform,
        warehouse: 'MIA',
        items: Math.floor(Math.random() * 5) + 1,
        total: Math.floor(Math.random() * 200) + 20,
        status: 'pending',
        date: new Date(),
        company: req.user.company
      });
    }

    // Mark as connected and update stats
    const updatedChannel = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      { 
        status: 'connected', 
        synced_at: new Date().toISOString(),
        $inc: { orders_today: numOrders },
        pending_sync: 0
      },
      { new: true }
    );

    res.json(updatedChannel);
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
