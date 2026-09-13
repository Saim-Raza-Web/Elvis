import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/Product.js';
import { lotRecallService } from '../services/lotRecallService.js';
import { abcEngine } from '../services/abcEngine.js';
import { parseGS1Barcode } from '../utils/gs1Parser.js';
import { replenishmentEngine } from '../services/replenishmentEngine.js';
import WarehouseTask from '../models/WarehouseTask.js';

const router = express.Router();

router.use(protect); // Secure all routes by default
router.use(validateWarehouse);

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

// GET autocomplete product search (F3-bis: SKU starts-with + Name contains)
router.get('/search', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const query = (req.query.q || req.query.query || '').trim();

    if (!query || query.length < 2) {
      return res.json([]);
    }

    const qUpper = query.toUpperCase();
    const products = await Model.find({ company: req.user.company });

    const matches = [];
    for (const p of products) {
      const skuUpper = (p.sku || '').toUpperCase();
      const nameUpper = (p.name || '').toUpperCase();
      const unitBCUpper = (p.unitBarcode || '').toUpperCase();
      const caseBCUpper = (p.caseBarcode || '').toUpperCase();

      let rank = -1;
      if (skuUpper === qUpper || unitBCUpper === qUpper || caseBCUpper === qUpper) {
        rank = 1; // Exact SKU or Barcode match
      } else if (skuUpper.startsWith(qUpper) || unitBCUpper.startsWith(qUpper) || caseBCUpper.startsWith(qUpper)) {
        rank = 2; // SKU or Barcode starts-with match
      } else if (nameUpper.includes(qUpper)) {
        rank = 3; // Name contains match
      }

      if (rank > 0) {
        matches.push({
          rank,
          sku: p.sku,
          name: p.name || p.sku,
          unitBarcode: p.unitBarcode || '',
          caseBarcode: p.caseBarcode || '',
          category: p.category || 'GEN',
          temperature: p.temperature_range || p.temperature || (p.category === 'COLD' ? 'Refrigerated 2°C–8°C' : 'Ambient'),
          qcProfile: p.qc_profile || p.qcProfile || (p.category === 'COLD' ? 'Cold Chain' : 'Standard QC'),
          product: p
        });
      }
    }

    matches.sort((a, b) => a.rank - b.rank || a.sku.localeCompare(b.sku));
    const results = matches.slice(0, 8).map(m => {
      const { rank, ...rest } = m;
      return rest;
    });

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// POST Parse GS1 Barcode (Pure Functional Parser Adapter)
router.post('/barcodes/parse', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const { barcode } = req.body || {};
    if (barcode === undefined || barcode === null) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_GS1_BARCODE', message: 'Barcode string is required in request body' }
      });
    }

    const result = parseGS1Barcode(barcode);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET resolve barcode (Unified Barcode Resolver)
router.get('/resolve-barcode/:barcode', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const rawBarcode = (req.params.barcode || '').trim();
    if (!rawBarcode) return res.status(400).json({ message: 'Barcode string required' });

    const barcodeUpper = rawBarcode.toUpperCase();
    const products = await Model.find({ company: req.user.company });
    
    // Find matching product by SKU, unitBarcode, or caseBarcode (case-insensitive)
    const matchedProduct = products.find(p => 
      (p.sku && p.sku.toUpperCase() === barcodeUpper) ||
      (p.unitBarcode && p.unitBarcode.toUpperCase() === barcodeUpper) ||
      (p.caseBarcode && p.caseBarcode.toUpperCase() === barcodeUpper)
    );

    if (!matchedProduct) {
      return res.status(404).json({
        found: false,
        barcode: rawBarcode,
        message: `Product not found / barcode '${rawBarcode}' not in catalog.`
      });
    }

    let matchType = 'sku';
    let multiplier = 1;

    if (matchedProduct.caseBarcode && matchedProduct.caseBarcode.toUpperCase() === barcodeUpper) {
      matchType = 'case';
      multiplier = matchedProduct.caseMultiplier || 1;
    } else if (matchedProduct.unitBarcode && matchedProduct.unitBarcode.toUpperCase() === barcodeUpper) {
      matchType = 'unit';
      multiplier = 1;
    }

    return res.json({
      found: true,
      barcode: rawBarcode,
      sku: matchedProduct.sku,
      productName: matchedProduct.name,
      matchType,
      multiplier,
      product: matchedProduct
    });
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

// Helper for barcode duplicate validation
async function validateBarcodes(companyId, body, currentId = null) {
  const { unitBarcode, caseBarcode, sku } = body;
  const uB = (unitBarcode || '').trim();
  const cB = (caseBarcode || '').trim();

  if (uB && cB && uB.toUpperCase() === cB.toUpperCase()) {
    throw new Error(`Unit Barcode and Case Barcode cannot be identical (${uB}).`);
  }

  const existingProducts = await Model.find({ company: companyId });
  for (const p of existingProducts) {
    if (currentId && p._id.toString() === currentId.toString()) continue;

    if (uB) {
      const uBUpper = uB.toUpperCase();
      if ((p.unitBarcode && p.unitBarcode.toUpperCase() === uBUpper) ||
          (p.caseBarcode && p.caseBarcode.toUpperCase() === uBUpper) ||
          (p.sku && p.sku.toUpperCase() === uBUpper)) {
        throw new Error(`Unit barcode '${uB}' is already assigned to SKU '${p.sku}'.`);
      }
    }

    if (cB) {
      const cBUpper = cB.toUpperCase();
      if ((p.unitBarcode && p.unitBarcode.toUpperCase() === cBUpper) ||
          (p.caseBarcode && p.caseBarcode.toUpperCase() === cBUpper) ||
          (p.sku && p.sku.toUpperCase() === cBUpper)) {
        throw new Error(`Case barcode '${cB}' is already assigned to SKU '${p.sku}'.`);
      }
    }
  }
}

// POST Atomic Lot Recall (< 2s performance requirement)
router.post('/lots/recall', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { lotNumber, sku, warehouse, owner, quantity, reason, recallId } = req.body;
    if (!lotNumber) return res.status(400).json({ message: 'lotNumber is required for recall' });

    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;

    const result = await lotRecallService.executeIdempotentLotRecall({
      companyId: req.user.company,
      lotNumber,
      sku,
      warehouse: warehouse !== undefined ? warehouse : req.context?.warehouse?.code,
      owner,
      quantity,
      reason,
      recallId,
      idempotencyKey,
      user: req.user
    });

    res.json(result);
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ message: err.message });
    }
    next(err);
  }
});

// POST Trigger ABC Classification Recalculation (Rolling 30-Day Confirmed Pick Volume)
router.post('/abc/recalculate', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { referenceDate } = req.body || {};
    const refDate = referenceDate ? new Date(referenceDate) : new Date();

    const result = await abcEngine.calculateCompanyABC(req.user.company, refDate);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET Company ABC Classifications Summary
router.get('/abc', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const products = await Model.find(
      { company: req.user.company },
      'sku name category sku_abc_class abc_calc_date abc_pick_count_period abc_class_override'
    ).sort({ abc_pick_count_period: -1, sku: 1 });

    const summary = {
      totalProducts: products.length,
      counts: { A: 0, B: 0, C: 0 },
      products: products.map(p => {
        const effClass = p.abc_class_override || p.sku_abc_class || 'C';
        if (summary.counts[effClass] !== undefined) summary.counts[effClass]++;
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
      })
    };

    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// STAGE 7: REPLENISHMENT ENGINE ENDPOINTS
// ==========================================

// GET Replenishment tasks
router.get('/replenishment/tasks', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const query = { company: req.user.company, task_type: 'replenishment' };
    if (req.query.warehouse) query.warehouse = req.query.warehouse;
    if (req.query.status) query.status = req.query.status;

    const tasks = await WarehouseTask.find(query).sort({ priority: 1, createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// POST Evaluate pick faces / dry-run simulator
router.post('/replenishment/evaluate', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const warehouse = req.body.warehouse || req.headers['x-warehouse-code'] || 'MIA';
    const dryRun = Boolean(req.body.dryRun);

    if (dryRun) {
      const sim = await replenishmentEngine.simulateReplenishment(req.user.company, warehouse);
      return res.json(sim);
    }

    const evalResult = await replenishmentEngine.evaluateWarehouse(req.user.company, warehouse);
    res.json(evalResult);
  } catch (err) {
    next(err);
  }
});

// POST Reserve replenishment
router.post('/replenishment/reserve', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
    const warehouse = req.body.warehouse || req.headers['x-warehouse-code'] || 'MIA';

    const result = await replenishmentEngine.reserveReplenishment(req.user.company, {
      ...req.body,
      warehouse,
      user: req.user?.name || 'system',
      idempotencyKey
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST Complete replenishment
router.post('/replenishment/:id/complete', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const result = await replenishmentEngine.completeReplenishment(req.user.company, req.params.id, req.user?.name || 'system');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST Cancel replenishment
router.post('/replenishment/:id/cancel', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const result = await replenishmentEngine.cancelReplenishment(req.user.company, req.params.id, req.user?.name || 'system');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH Reclassify ownerType for UNKNOWN inventory
router.patch('/reclassify', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const { balanceIds, newOwnerType } = req.body;
    
    if (!Array.isArray(balanceIds) || balanceIds.length === 0) {
      return res.status(400).json({ message: 'balanceIds array is required.' });
    }
    
    if (!newOwnerType || !['COMPANY', 'CUSTOMER'].includes(newOwnerType)) {
      return res.status(400).json({ message: 'newOwnerType must be either COMPANY or CUSTOMER.' });
    }

    const InventoryBalance = (await import('../models/InventoryBalance.js')).default;
    const ActivityLog = (await import('../models/ActivityLog.js')).default;

    // We can only reclassify balances that are currently UNKNOWN
    const result = await InventoryBalance.updateMany(
      { 
        _id: { $in: balanceIds }, 
        company: req.user.company, 
        ownerType: 'UNKNOWN' 
      },
      { 
        $set: { ownerType: newOwnerType } 
      }
    );

    if (result.modifiedCount > 0) {
      await ActivityLog.create({
        logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        action: 'INVENTORY_RECLASSIFICATION',
        module: 'Inventory',
        user: req.user.name || 'System Admin',
        userId: req.user._id,
        company: req.user.company,
        details: `Reclassified ${result.modifiedCount} UNKNOWN inventory balances to ${newOwnerType}.`
      });
    }

    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: `Successfully reclassified ${result.modifiedCount} balances.`
    });
  } catch (err) {
    next(err);
  }
});

// POST Initial Stock Load (Bypasses Putaway Tasks)
router.post('/initial-stock-load', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { sku, bin, qty, owner, ownerType, lotNumber, batchNumber, expiryDate } = req.body;
    if (req.context && req.context.warehouses && req.context.warehouses.length > 1) {
      return res.status(400).json({ message: 'Multiple warehouses provided. This endpoint requires exactly one warehouse.' });
    }
    const warehouse = req.context?.warehouse?.code;

    if (!sku || !bin || qty === undefined || !warehouse) {
      return res.status(400).json({ message: 'sku, bin, qty, and warehouse are required' });
    }
    
    if (!ownerType || !['COMPANY', 'CUSTOMER'].includes(ownerType)) {
      return res.status(400).json({ message: 'ownerType (COMPANY or CUSTOMER) is strictly required for physical inventory creation.' });
    }

    const InventoryBalance = (await import('../models/InventoryBalance.js')).default;
    const InventoryTransaction = (await import('../models/InventoryTransaction.js')).default;
    const ActivityLog = (await import('../models/ActivityLog.js')).default;

    // Hard Lot Integrity check: ONE LOCATION = ONE LOT + ONE SKU + ONE OWNER
    const existing = await InventoryBalance.find({ company: req.user.company, bin, qtyAvailable: { $gt: 0 } });
    if (existing.length > 0) {
      if (existing.some(e => e.owner && owner && e.owner !== owner)) {
        return res.status(400).json({ message: `Lot Integrity Violation: Location ${bin} is occupied by another 3PL Owner` });
      }
      if (existing.some(e => e.sku && e.sku !== sku)) {
        return res.status(400).json({ message: `Lot Integrity Violation: Location ${bin} is occupied by another SKU` });
      }
      if (existing.some(e => e.lotNumber && lotNumber && e.lotNumber !== lotNumber)) {
        return res.status(400).json({ message: `Lot Integrity Violation: Location ${bin} is occupied by another Lot Number` });
      }
    }

    const balance = await InventoryBalance.findOneAndUpdate(
      { company: req.user.company, warehouse: warehouse || 'MIA', sku, bin, owner: owner || 'Default 3PL', ownerType },
      {
        $inc: { qtyAvailable: Number(qty) },
        $set: { lotNumber: lotNumber || 'INIT-LOT', batchNumber, expiryDate }
      },
      { upsert: true, new: true }
    );

    await InventoryTransaction.create({
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      company: req.user.company,
      type: 'RECEIVING',
      sku,
      qty: Number(qty),
      fromLocation: 'SYSTEM_LOAD',
      toLocation: bin,
      owner: owner || 'Default 3PL',
      ownerType,
      lotNumber: lotNumber || 'INIT-LOT',
      user: req.user.name || 'System Admin'
    });

    await ActivityLog.create({
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      action: 'INITIAL_STOCK_LOAD',
      module: 'Inventory',
      user: req.user.name || 'System Admin',
      userId: req.user._id,
      company: req.user.company,
      details: `Loaded ${qty} units of ${sku} directly to ${bin} (Lot: ${lotNumber || 'INIT-LOT'}).`
    });

    res.status(201).json({ message: 'Initial stock loaded successfully', balance });
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    await validateBarcodes(req.user.company, req.body);
    const data = { ...req.body, company: req.user.company };
    const item = await Model.create(data);
    res.status(201).json(item);
  } catch (err) {
    if (err.message && err.message.includes('already assigned')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
});

// UPDATE
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    await validateBarcodes(req.user.company, req.body, req.params.id);
    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    if (err.message && err.message.includes('already assigned')) {
      return res.status(400).json({ message: err.message });
    }
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
