import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/Product.js';

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

// GET low-stock / replenishment alerts
router.get('/alerts/low-stock', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    // Products where available qty is at or below their reorder_point (or min_stock fallback)
    const products = await Model.find({ company: req.user.company });
    const alerts = products
      .filter(p => {
        const threshold = p.reorder_point ?? p.min_stock ?? null;
        return threshold !== null && (p.qty_available ?? 0) <= threshold;
      })
      .map(p => ({
        _id: p._id,
        sku: p.sku,
        name: p.name,
        qty_available: p.qty_available ?? 0,
        reorder_point: p.reorder_point ?? p.min_stock,
        max_stock: p.max_stock,
        supplier_lead_time_days: p.supplier_lead_time_days,
        recommended_order_qty: Math.max(0, (p.max_stock ?? 100) - (p.qty_available ?? 0)),
        owner: p.owner,
        warehouse: p.warehouse,
      }));
    res.json(alerts);
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
