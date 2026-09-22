import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/StorageRule.js';
import Product from '../models/Product.js';
import { putawayEngine } from '../services/putawayEngine.js';
import { pickingEngine } from '../services/pickingEngine.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

// POST dry-run simulator for Putaway
router.post('/simulate-putaway', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    if (req.context && req.context.warehouses && req.context.warehouses.length > 1) {
      return res.status(400).json({ message: 'Multiple warehouses provided. This endpoint requires exactly one warehouse.' });
    }
    const warehouse = req.context?.warehouse?.code;
    const { sku, category, owner, lotNumber, expiryDate, qty, isHazmat, tempRequirement } = req.body;
    
    if (!warehouse) return res.status(400).json({ message: 'Warehouse is required' });

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
export async function handleSimulatePicking(req, res, next) {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    if (req.context && req.context.warehouses && req.context.warehouses.length > 1) {
      return res.status(400).json({ message: 'Multiple warehouses provided. This endpoint requires exactly one warehouse.' });
    }
    const warehouse = req.context?.warehouse?.code || req.body.warehouse;
    const { sku, owner, customer, qtyNeeded, quantity, qty, strategy, minPickUnit, evaluationNow } = req.body;
    
    if (!warehouse) return res.status(400).json({ message: 'Warehouse is required' });
    if (!sku) return res.status(400).json({ message: 'SKU is required' });

    const requestedQty = Number(qtyNeeded || quantity || qty) || 1;

    // FORCED DRY-RUN: Simulator must ALWAYS be read-only, regardless of client payload
    const result = await pickingEngine.evaluatePickAllocation({
      companyId: req.user.company,
      warehouse,
      sku,
      owner,
      customer,
      qtyNeeded: requestedQty,
      strategy: strategy || 'FEFO',
      minPickUnit: minPickUnit || 'EA',
      dryRun: true, // Explicitly forced true
      evaluationNow: evaluationNow ? new Date(evaluationNow) : undefined
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

router.post('/simulate-picking', handleSimulatePicking);

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

import { seedCanonicalStorageRules } from '../services/storageRuleSeeder.js';

// POST /api/v1/storage-rules/seed — Idempotent Canonical 11 Rules Seeder
router.post('/seed', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    if (!req.context || !req.context.warehouse || req.context.warehouse.invalid) {
      return res.status(400).json({ message: 'A valid warehouse is required to seed storage rules.' });
    }

    const warehouseId = req.context.warehouse.id;
    const { overwriteCustom = false } = req.body || {};

    const result = await seedCanonicalStorageRules({
      companyId: req.user.company,
      warehouseId,
      overwriteCustom: Boolean(overwriteCustom)
    });

    res.status(200).json({
      success: true,
      message: `Successfully processed canonical storage rules for warehouse ${req.context.warehouse.code}.`,
      ...result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/storage-rules/reorder — Bulk priority reorder
router.post('/reorder', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const { ruleIds } = req.body;
    if (!Array.isArray(ruleIds) || ruleIds.length === 0) {
      return res.status(400).json({ message: 'ruleIds array required' });
    }

    const bulkOps = ruleIds.map((id, idx) => ({
      updateOne: {
        filter: { _id: id, company: req.user.company },
        update: { $set: { priority: idx + 1 } }
      }
    }));

    if (bulkOps.length > 0) {
      await Model.bulkWrite(bulkOps);
    }
    const updatedRules = await Model.find({ company: req.user.company }).sort({ priority: 1 });
    res.json({ success: true, rules: updatedRules });
  } catch (err) { next(err); }
});

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const query = { company: req.user.company };

    if (req.context && req.context.warehouse) {
      if (req.context.warehouse.invalid) {
        query.warehouse = null;
      } else {
        query.warehouse = req.context.warehouse.id;
      }
    }

    if (req.query.ruleType) {
      query.ruleType = req.query.ruleType;
    }

    const result = await paginateQuery(Model, query, req, { sort: 'priority' });
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
    if (req.context && req.context.warehouse && !req.context.warehouse.invalid) {
      data.warehouse = req.context.warehouse.id;
    }
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

/**
 * Creates an Express router alias for a specific ruleType (e.g. PUTAWAY or PICKING).
 * Enforces ruleType server-side across all operations (GET, POST, PUT, DELETE)
 * preventing client-side ruleType tampering.
 *
 * @param {'PUTAWAY'|'PICKING'} forcedRuleType
 * @returns {express.Router}
 */
export function createRuleTypeRouter(forcedRuleType) {
  const aliasRouter = express.Router();
  aliasRouter.use(protect);
  aliasRouter.use(validateWarehouse);

  // Enforce server-side ruleType on all incoming queries and bodies
  aliasRouter.use((req, res, next) => {
    if (req.query && typeof req.query === 'object') {
      req.query.ruleType = forcedRuleType;
    }

    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      req.body.ruleType = forcedRuleType;
    }
    next();
  });

  // GET / — List rules strictly scoped to forcedRuleType
  aliasRouter.get('/', async (req, res, next) => {
    try {
      if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
      const query = { company: req.user.company, ruleType: forcedRuleType };

      if (req.context && req.context.warehouse) {
        if (req.context.warehouse.invalid) {
          query.warehouse = null;
        } else {
          query.warehouse = req.context.warehouse.id;
        }
      }

      const result = await paginateQuery(Model, query, req, { sort: 'priority' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /:id — Fetch rule ensuring it belongs to forcedRuleType
  aliasRouter.get('/:id', async (req, res, next) => {
    try {
      if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).json({ message: `Rule not found for type ${forcedRuleType}` });
      }
      const item = await Model.findOne({ _id: req.params.id, company: req.user.company, ruleType: forcedRuleType });
      if (!item) return res.status(404).json({ message: `Rule not found for type ${forcedRuleType}` });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  // POST / — Create rule strictly forced to forcedRuleType
  aliasRouter.post('/', requireOpsRole, async (req, res, next) => {
    try {
      if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
      const data = { ...req.body, company: req.user.company, ruleType: forcedRuleType };
      if (req.context && req.context.warehouse && !req.context.warehouse.invalid) {
        data.warehouse = req.context.warehouse.id;
      }
      const item = await Model.create(data);
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  });

  // PUT /:id — Update rule ensuring it belongs to forcedRuleType and cannot be morphed
  aliasRouter.put('/:id', requireOpsRole, async (req, res, next) => {
    try {
      if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).json({ message: `Rule not found for type ${forcedRuleType}` });
      }
      const updateData = { ...req.body, ruleType: forcedRuleType };
      const item = await Model.findOneAndUpdate(
        { _id: req.params.id, company: req.user.company, ruleType: forcedRuleType },
        updateData,
        { new: true }
      );
      if (!item) return res.status(404).json({ message: `Rule not found for type ${forcedRuleType}` });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:id — Delete rule ensuring it belongs to forcedRuleType
  aliasRouter.delete('/:id', requireOpsRole, async (req, res, next) => {
    try {
      if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).json({ message: `Rule not found for type ${forcedRuleType}` });
      }
      const item = await Model.findOneAndDelete({ _id: req.params.id, company: req.user.company, ruleType: forcedRuleType });
      if (!item) return res.status(404).json({ message: `Rule not found for type ${forcedRuleType}` });
      res.json({ message: 'Deleted successfully' });
    } catch (err) {
      next(err);
    }
  });

  return aliasRouter;
}

export default router;
