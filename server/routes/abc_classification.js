import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { abcEngine } from '../services/abcEngine.js';
import Product from '../models/Product.js';

const router = express.Router();
const requireOpsRole = requireRole('admin', 'manager');

// GET /api/v1/abc-classification — Get ABC classification summary & products
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const products = await Product.find(
      { company: req.user.company },
      'sku name category sku_abc_class abc_calc_date abc_pick_count_period abc_class_override'
    ).sort({ abc_pick_count_period: -1, sku: 1 });

    const counts = { A: 0, B: 0, C: 0 };
    const productList = products.map(p => {
      const effClass = p.abc_class_override || p.sku_abc_class || 'C';
      if (counts[effClass] !== undefined) counts[effClass]++;
      return {
        _id: p._id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        calculatedClass: p.sku_abc_class || 'C',
        effectiveClass: effClass,
        volume: p.abc_pick_count_period || 0,
        calcDate: p.abc_calc_date || null,
        hasOverride: Boolean(p.abc_class_override),
        override: p.abc_class_override || null
      };
    });

    res.json({
      totalProducts: products.length,
      counts,
      products: productList
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/abc-classification/recalculate — Trigger ABC classification recalculation
router.post('/recalculate', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { referenceDate } = req.body || {};
    const refDate = referenceDate ? new Date(referenceDate) : new Date();

    const result = await abcEngine.calculateCompanyABC(req.user.company, refDate);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
