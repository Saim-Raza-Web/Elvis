import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/StorageRule.js';
import Product from '../models/Product.js';
import { putawayEngine } from '../services/putawayEngine.js';
import { pickingEngine } from '../services/pickingEngine.js';

const router = express.Router();
router.use(protect);

const requireOpsRole = requireRole('admin', 'manager');

// POST dry-run simulator for Putaway
router.post('/simulate-putaway', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { warehouse, sku, category, owner, lotNumber, expiryDate, qty, isHazmat, tempRequirement } = req.body;
    const result = await putawayEngine.evaluatePutawayLocation({
      companyId: req.user.company,
      warehouse,
      sku,
      category,
      owner,
      lotNumber,
      expiryDate,
      qty: Number(qty) || 1,
      isHazmat: Boolean(isHazmat),
      tempRequirement
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST dry-run simulator for Picking
router.post('/simulate-picking', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { warehouse, sku, owner, qtyNeeded, strategy, minPickUnit } = req.body;
    const result = await pickingEngine.evaluatePickAllocation({
      companyId: req.user.company,
      warehouse,
      sku,
      owner,
      qtyNeeded: Number(qtyNeeded) || 1,
      strategy: strategy || 'FEFO',
      minPickUnit: minPickUnit || 'EA'
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET suggest location for a product (uses putawayEngine)
router.get('/suggest/:sku', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const product = await Product.findOne({ sku: req.params.sku, company: req.user.company });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const evalResult = await putawayEngine.evaluatePutawayLocation({
      companyId: req.user.company,
      sku: product.sku,
      category: product.category,
      owner: product.owner,
      tempRequirement: product.tempRequirement
    });
    
    res.json({ sku: product.sku, suggestedZone: evalResult.zone || 'Default Zone', suggestedLocation: evalResult.selectedLocation });
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
