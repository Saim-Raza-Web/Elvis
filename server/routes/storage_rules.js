import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/StorageRule.js';
import Product from '../models/Product.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');

// GET suggest location for a product
router.get('/suggest/:sku', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const product = await Product.findOne({ sku: req.params.sku, company: req.user.company });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const rules = await Model.find({ company: req.user.company, isActive: true }).sort({ priority: 1 });
    
    let suggestedZone = "Default Zone";
    for (const rule of rules) {
      let matched = false;
      if (rule.conditionType === 'category' && product.category === rule.conditionValue) matched = true;
      if (rule.conditionType === 'manufacturer' && product.manufacturer === rule.conditionValue) matched = true;
      if (rule.conditionType === 'owner' && product.owner === rule.conditionValue) matched = true;
      if (rule.conditionType === 'brand' && product.brand === rule.conditionValue) matched = true;
      
      if (matched) {
        suggestedZone = rule.targetZone;
        break; // first matching rule determines location based on priority
      }
    }
    
    res.json({ sku: product.sku, suggestedZone });
  } catch (err) {
    next(err);
  }
});

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const result = await paginateQuery(Model, { company: req.user.company }, req, { sort: 'priority' });
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
