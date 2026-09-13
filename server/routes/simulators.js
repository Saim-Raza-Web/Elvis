import express from 'express';
import { protect } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { handleSimulatePicking } from './storage_rules.js';
import { putawayEngine } from '../services/putawayEngine.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

// POST /api/v1/simulators/picking (Thin adapter calling pickingEngine with dryRun: true)
router.post('/picking', handleSimulatePicking);

// POST /api/v1/simulators/putaway
router.post('/putaway', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const warehouse = req.context?.warehouse?.code || req.body.warehouse;
    const { sku, category, owner, lotNumber, expiryDate, qty, isHazmat, tempRequirement, pallets } = req.body;
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
      tempRequirement,
      pallets
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
