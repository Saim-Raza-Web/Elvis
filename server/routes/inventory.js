import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/Product.js';
import { lotRecallService } from '../services/lotRecallService.js';
import { handleExecuteLotRecall } from './lot_recalls.js';
import { abcEngine } from '../services/abcEngine.js';
import { parseGS1Barcode } from '../utils/gs1Parser.js';
import { replenishmentEngine } from '../services/replenishmentEngine.js';
import WarehouseTask from '../models/WarehouseTask.js';
import Company from '../models/Company.js';
import { validateOwnerMaster } from '../utils/ownerValidation.js';
import * as XLSX from 'xlsx';

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
router.post('/lots/recall', requireOpsRole, handleExecuteLotRecall);

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

// POST Initial Stock Load (Bulk / CSV support for RF-P19)
// RF-P19 Requirements:
//  - Each row is committed inside its own MongoDB transaction (full atomicity)
//  - Product.qty_available synced via atomic $inc
//  - entryDate preserved from row data or defaults to now
//  - No MIA fallback: warehouse must be explicitly provided
//  - Lot Integrity validated before write
//  - G-01 owner validation enforced
router.post('/initial-stock-load', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    // RF-P19: No MIA fallback — warehouse must be explicitly resolved
    const warehouse = req.context?.warehouse?.code;
    if (!warehouse) {
      return res.status(400).json({
        message: 'RF-P19: A specific warehouse must be provided in the request context. The MIA default is not permitted for initial stock loads.'
      });
    }

    const Warehouse = (await import('../models/Warehouse.js')).default;
    const Location = (await import('../models/Location.js')).default;
    const InventoryBalance = (await import('../models/InventoryBalance.js')).default;
    const InventoryTransaction = (await import('../models/InventoryTransaction.js')).default;
    const ActivityLog = (await import('../models/ActivityLog.js')).default;
    const mongoose = (await import('mongoose')).default;

    const warehouseDoc = await Warehouse.findOne({ code: warehouse, company: req.user.company });

    let rawRows = null;
    if (Array.isArray(req.body)) {
      rawRows = req.body;
    } else if (req.body && typeof req.body === 'object') {
      if (req.body.csvData) {
        const workbook = XLSX.read(req.body.csvData, { type: 'string' });
        const sheetName = workbook.SheetNames[0];
        rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      } else if (req.body.fileBase64) {
        const buffer = Buffer.from(req.body.fileBase64, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      } else if (Object.keys(req.body).length > 0) {
        rawRows = [req.body];
      }
    }

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ message: 'No data provided. Supply a JSON array or CSV/Excel file of stock rows.' });
    }

    // Normalize rows
    const rows = rawRows.map((r, i) => {
      const sku = (r.SKU || r.sku || '').trim();
      const bin = (r.Location || r.location || r.bin || r.Bin || '').trim();
      const qtyRaw = r.Quantity !== undefined ? r.Quantity : (r.quantity !== undefined ? r.quantity : (r.qty !== undefined ? r.qty : r.Qty));
      const ownerRaw = r.Owner !== undefined ? r.Owner : r.owner;
      const owner = ownerRaw !== undefined && ownerRaw !== null ? String(ownerRaw).trim() : '';
      let ownerType = (r.OwnerType || r.ownerType || '').trim();
      if (!ownerType) {
        if (!owner || owner === 'Internal Stock' || owner === String(req.user.company)) {
          ownerType = 'COMPANY';
        } else {
          ownerType = 'CUSTOMER';
        }
      }
      const lotNumber = (r.Lot || r.lot || r.lotNumber || r.LotNumber || 'INIT-LOT').trim();
      const batchNumber = (r.Batch || r.batch || r.batchNumber || r.BatchNumber || '').trim();
      const expiryDate = r.ExpiryDate || r.expiryDate || r['Expiry Date'];
      const entryDate = r.EntryDate || r['Entry Date'] || r.entryDate || r.date || r.Date;

      return {
        rowNum: i + 1,
        sku,
        bin,
        qty: qtyRaw,
        owner,
        ownerType,
        lotNumber,
        batchNumber,
        expiryDate,
        entryDate
      };
    });

    // ── PASS 1: Pre-validation of ALL rows before database mutation ───────────
    const errors = [];

    for (const r of rows) {
      if (!r.sku) {
        errors.push(`Row ${r.rowNum}: sku is required.`);
        continue;
      }
      if (!r.bin) {
        errors.push(`Row ${r.rowNum}: bin is required.`);
        continue;
      }
      if (r.qty === undefined || r.qty === null || isNaN(Number(r.qty)) || Number(r.qty) <= 0) {
        errors.push(`Row ${r.rowNum}: qty must be a positive number.`);
        continue;
      }
      if (!['COMPANY', 'CUSTOMER'].includes(r.ownerType)) {
        errors.push(`Row ${r.rowNum}: ownerType (COMPANY or CUSTOMER) is strictly required.`);
        continue;
      }

      // Check date validity
      if (r.entryDate && isNaN(new Date(r.entryDate).getTime())) {
        errors.push(`Row ${r.rowNum}: Invalid entryDate.`);
        continue;
      }

      // Check product existence
      const productDoc = await Model.findOne({ sku: r.sku, company: req.user.company });
      if (!productDoc) {
        errors.push(`Row ${r.rowNum}: SKU '${r.sku}' does not exist in catalog.`);
        continue;
      }

      // Check location belongs to warehouse
      if (warehouseDoc) {
        const locDoc = await Location.findOne({ code: r.bin, company: req.user.company });
        if (locDoc && locDoc.warehouse && locDoc.warehouse.toString() !== warehouseDoc._id.toString()) {
          errors.push(`Row ${r.rowNum}: Location '${r.bin}' belongs to a different warehouse.`);
          continue;
        }
      }

      // G-01: Central Client/Owner Master Enforcement
      const ownerError = await validateOwnerMaster(r.owner, r.ownerType, req.user.company);
      if (ownerError) {
        errors.push(`Row ${r.rowNum}: ${ownerError}`);
        continue;
      }

      // Lot Integrity pre-check against existing balances
      const existingSlot = await InventoryBalance.find({
        company: req.user.company, bin: r.bin, qtyAvailable: { $gt: 0 }
      });
      if (existingSlot.length > 0) {
        if (existingSlot.some(e => e.owner && r.owner && e.owner !== r.owner)) {
          errors.push(`Row ${r.rowNum}: Lot Integrity Violation: Location ${r.bin} occupied by another 3PL Owner (${existingSlot[0].owner}).`);
          continue;
        }
        if (existingSlot.some(e => e.sku && e.sku !== r.sku)) {
          errors.push(`Row ${r.rowNum}: Lot Integrity Violation: Location ${r.bin} occupied by another SKU (${existingSlot[0].sku}).`);
          continue;
        }
        if (existingSlot.some(e => e.lotNumber && r.lotNumber && e.lotNumber !== r.lotNumber)) {
          errors.push(`Row ${r.rowNum}: Lot Integrity Violation: Location ${r.bin} occupied by another Lot Number (${existingSlot[0].lotNumber}).`);
          continue;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        message: 'All rows failed validation or import',
        errors,
        successful: 0
      });
    }

    // ── PASS 2: Atomic Batch Execution inside a single session ─────────────
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const results = [];
      for (const r of rows) {
        const qtyNum = Number(r.qty);
        const effectiveEntryDate = r.entryDate ? new Date(r.entryDate) : new Date();

        // 1. Atomic InventoryBalance upsert
        const balance = await InventoryBalance.findOneAndUpdate(
          {
            company: req.user.company,
            warehouse,
            sku: r.sku,
            bin: r.bin,
            owner: r.owner,
            ownerType: r.ownerType,
            lotNumber: r.lotNumber
          },
          {
            $inc: { qtyAvailable: qtyNum },
            $set: {
              batchNumber: r.batchNumber || '',
              expiryDate: r.expiryDate ? new Date(r.expiryDate) : undefined
            },
            $min: { entryDate: effectiveEntryDate }
          },
          { upsert: true, new: true, session }
        );

        // 2. InventoryTransaction record
        await InventoryTransaction.create([{
          transactionId: 'TXN-ISL-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          company: req.user.company,
          type: 'RECEIVING',
          sku: r.sku,
          qty: qtyNum,
          warehouse,
          bin: r.bin,
          fromLocation: 'SYSTEM_LOAD',
          toLocation: r.bin,
          owner: r.owner,
          ownerType: r.ownerType,
          lotNumber: r.lotNumber,
          batchNumber: r.batchNumber || '',
          expiryDate: r.expiryDate ? new Date(r.expiryDate) : undefined,
          entryDate: effectiveEntryDate,
          user: req.user.name || req.user.email || 'System Admin'
        }], { session });

        // 3. RF-P19: Sync Product.qty_available atomically
        await Model.findOneAndUpdate(
          { company: req.user.company, sku: r.sku },
          { $inc: { qty_available: qtyNum } },
          { session }
        );

        // 4. Activity Log
        await ActivityLog.create([{
          logId: 'LOG-ISL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          action: 'INITIAL_STOCK_LOAD',
          module: 'Inventory',
          user: req.user.name || req.user.email || 'System Admin',
          userId: req.user._id,
          company: req.user.company,
          details: `Loaded ${qtyNum} units of ${r.sku} to ${r.bin} in ${warehouse} (Lot: ${r.lotNumber}, EntryDate: ${effectiveEntryDate.toISOString().slice(0, 10)}).`
        }], { session });

        results.push({ row: r.rowNum, sku: r.sku, bin: r.bin, qty: qtyNum, balanceId: balance._id });
      }

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({
        message: `Initial stock loaded successfully (${results.length} rows).`,
        imported: results.length,
        results
      });
    } catch (txnErr) {
      await session.abortTransaction();
      session.endSession();
      throw txnErr;
    }
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    // G-01: Central Client/Owner Master Enforcement
    if (req.body.owner) {
      const company = await Company.findById(req.user.company);
      if (company && req.body.owner !== company.name) {
        const ownerError = await validateOwnerMaster(req.body.owner, 'CUSTOMER', req.user.company);
        if (ownerError) {
          return res.status(400).json({ message: ownerError });
        }
      }
    }

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

    // G-01: Central Client/Owner Master Enforcement
    if (req.body.owner !== undefined) {
      const company = await Company.findById(req.user.company);
      if (company && req.body.owner && req.body.owner !== company.name) {
        const ownerError = await validateOwnerMaster(req.body.owner, 'CUSTOMER', req.user.company);
        if (ownerError) {
          return res.status(400).json({ message: ownerError });
        }
      }
    }

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
