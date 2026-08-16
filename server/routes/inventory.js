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
