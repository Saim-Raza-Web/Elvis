import express from 'express';
import { protect } from '../middleware/auth.js';
import StockCount from '../models/StockCount.js';
import Product from '../models/Product.js';

const router = express.Router();
router.use(protect);

// GET all stock counts
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const items = await StockCount.find({ company: req.user.company }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) { next(err); }
});

// GET single stock count
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await StockCount.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// CREATE a new stock count session (auto-populate lines from inventory)
router.post('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { name, scope, scopeValue, warehouse } = req.body;

    // Build query to auto-populate lines from current inventory
    let productQuery = { company: req.user.company };
    if (scope === 'product' && scopeValue) productQuery.sku = scopeValue;

    const products = await Product.find(productQuery);

    const lines = products
      .filter(p => p.qty_available > 0 || p.qty_reserved > 0)
      .map(p => ({
        location: p.warehouse || warehouse || 'Unknown',
        sku: p.sku,
        product: p.name,
        theoretical_qty: (p.qty_available || 0) + (p.qty_reserved || 0),
        counted_qty: null,
        discrepancy: 0,
        status: 'pending'
      }));

    const countId = `SC-${Date.now().toString().slice(-8)}`;
    const item = await StockCount.create({
      countId,
      name,
      scope: scope || 'zone',
      scopeValue,
      warehouse,
      status: 'open',
      lines,
      startedBy: req.user.name,
      company: req.user.company
    });

    res.status(201).json(item);
  } catch (err) { next(err); }
});

// UPDATE a line (operator scans a count)
router.put('/:id/line/:lineId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { counted_qty } = req.body;
    const count = await StockCount.findOne({ _id: req.params.id, company: req.user.company });
    if (!count) return res.status(404).json({ message: 'Count session not found' });

    const line = count.lines.id(req.params.lineId);
    if (!line) return res.status(404).json({ message: 'Line not found' });

    line.counted_qty = counted_qty;
    line.discrepancy = counted_qty - line.theoretical_qty;
    line.status = 'counted';

    if (count.status === 'open') count.status = 'in_progress';
    await count.save();
    res.json(count);
  } catch (err) { next(err); }
});

// CLOSE count & apply adjustments (Manager action)
router.put('/:id/close', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const count = await StockCount.findOne({ _id: req.params.id, company: req.user.company });
    if (!count) return res.status(404).json({ message: 'Count session not found' });
    if (count.status === 'closed') return res.status(400).json({ message: 'Already closed' });

    // Apply discrepancies to inventory
    for (const line of count.lines) {
      if (line.status === 'counted' && line.discrepancy !== 0) {
        await Product.findOneAndUpdate(
          { sku: line.sku, company: req.user.company },
          { $inc: { qty_available: line.discrepancy } }
        );
        line.status = 'adjusted';
      }
    }

    count.status = 'closed';
    count.approvedBy = req.user.name;
    count.closedAt = new Date();
    await count.save();
    res.json(count);
  } catch (err) { next(err); }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await StockCount.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

export default router;
