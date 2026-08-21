import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Location from '../models/Location.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';

const router = express.Router();
router.use(protect);

const requireOpsRole = requireRole('admin', 'manager');

// ── GET /api/v1/locations — Search, Filter & Paginate Locations ──
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const query = { company: req.user.company };

    if (req.query.search) {
      const s = String(req.query.search).trim();
      const regex = new RegExp(s, 'i');
      query.$or = [
        { code: regex },
        { name: regex },
        { zone: regex },
        { aisle: regex },
        { shelf: regex },
        { bin: regex },
        { warehouse: regex }
      ];
    }

    if (req.query.warehouse) {
      query.warehouse = req.query.warehouse;
    }

    if (req.query.zoneType && req.query.zoneType !== 'All') {
      query.zoneType = req.query.zoneType;
    }

    if (req.query.status && req.query.status !== 'All') {
      query.status = req.query.status;
    }

    const result = await paginateQuery(Location, query, req);

    // Enrich locations with real stock qty + SKUs from InventoryBalance
    const locationCodes = (result.data || result).map((l) => l.code || l.bin);
    const balances = await InventoryBalance.aggregate([
      { $match: { company: req.user.company, bin: { $in: locationCodes } } },
      { $group: { _id: '$bin', totalQty: { $sum: '$qtyAvailable' }, skus: { $addToSet: '$sku' }, owners: { $addToSet: '$owner' } } }
    ]);
    const balanceMap = {};
    for (const b of balances) balanceMap[b._id] = b;

    // Fetch product names for SKUs found in bins
    const allSkus = [...new Set(balances.flatMap(b => b.skus))];
    const products = await Product.find({ sku: { $in: allSkus }, company: req.user.company }, 'sku name').lean();
    const productMap = {};
    for (const p of products) productMap[p.sku] = p.name;

    const enrichLoc = (loc) => {
      const raw = loc.toObject ? loc.toObject() : loc;
      const bal = balanceMap[raw.code];
      return {
        ...raw,
        qty: bal ? bal.totalQty : 0,
        skus: bal ? bal.skus : [],
        owners: bal ? bal.owners : [],
        sku: bal?.skus?.[0] || raw.sku || null,
        product: bal?.skus?.[0] ? (productMap[bal.skus[0]] || bal.skus[0]) : (raw.product || null)
      };
    };

    if (result.data) {
      result.data = result.data.map(enrichLoc);
    } else {
      return res.json((result).map(enrichLoc));
    }
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/v1/locations/:id — Single Location Details ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Location.findOne({
      $or: [{ _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : null }, { code: req.params.id }],
      company: req.user.company
    });
    if (!item) return res.status(404).json({ message: 'Location not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// ── POST /api/v1/locations — Create Location with Capacity & Zone Config ──
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { code, warehouse = 'MIA', maxUnits = 500, maxWeight = 1000, maxVolume = 10, zoneType = 'AMBIENT', status = 'ACTIVE' } = req.body;

    if (!code || !String(code).trim()) {
      return res.status(400).json({ message: 'Location code is required (e.g. Z1-A1-R1-S1-B1).' });
    }

    const existing = await Location.findOne({ code: code.trim(), company: req.user.company });
    if (existing) {
      return res.status(400).json({ message: `Location code '${code.trim()}' already exists in warehouse ${warehouse}.` });
    }

    const item = await Location.create({
      ...req.body,
      code: code.trim(),
      warehouse,
      maxUnits: Number(maxUnits) || 500,
      maxWeight: Number(maxWeight) || 1000,
      maxVolume: Number(maxVolume) || 10,
      zoneType,
      status,
      company: req.user.company
    });

    res.status(201).json(item);
  } catch (err) { next(err); }
});

// ── PUT /api/v1/locations/:id — Edit Location Configuration ──
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Location.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      req.body,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Location not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// ── POST /api/v1/locations/import-csv — Whole-File Validation CSV Importer ──
router.post('/import-csv', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { locations } = req.body;
    if (!Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ message: 'CSV payload must contain an array of location objects' });
    }

    const errors = [];
    const validLocationCodes = new Set();

    // Pass 1: Whole-File Validation (Accumulates ALL errors, 0 partial commits)
    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const rowNum = i + 1;

      if (!loc.code || !String(loc.code).trim()) {
        errors.push(`Row ${rowNum}: Location 'code' is required.`);
      } else {
        const cleanCode = String(loc.code).trim().toUpperCase();
        if (validLocationCodes.has(cleanCode)) {
          errors.push(`Row ${rowNum}: Duplicate location code '${cleanCode}' within CSV file.`);
        }
        validLocationCodes.add(cleanCode);
      }

      if (loc.tempMin !== undefined && loc.tempMax !== undefined) {
        if (Number(loc.tempMin) > Number(loc.tempMax)) {
          errors.push(`Row ${rowNum}: tempMin (${loc.tempMin}°C) cannot be greater than tempMax (${loc.tempMax}°C).`);
        }
      }

      if (loc.locationType && !['PALLET', 'SHELF', 'FLOOR', 'STAGING', 'OVERFLOW', 'HAZMAT', 'PICK_FACE'].includes(loc.locationType.toUpperCase())) {
        errors.push(`Row ${rowNum}: Invalid locationType '${loc.locationType}'. Allowed: PALLET, SHELF, FLOOR, STAGING, OVERFLOW, HAZMAT, PICK_FACE.`);
      }
    }

    // Check database collisions in Pass 1
    const existingDbDocs = await Location.find({
      company: req.user.company,
      code: { $in: Array.from(validLocationCodes) }
    });

    if (existingDbDocs.length > 0) {
      for (const doc of existingDbDocs) {
        errors.push(`Database Collision: Location code '${doc.code}' already exists in warehouse.`);
      }
    }

    // If ANY row failed, ABORT completely (0 records committed)
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: `CSV Import Failed: ${errors.length} validation error(s) found. Whole file was rejected.`,
        errors
      });
    }

    // Pass 2: Batch Commit after 100% Validation Success
    const docsToInsert = locations.map(loc => ({
      ...loc,
      code: String(loc.code).trim().toUpperCase(),
      warehouse: loc.warehouse || 'MIA',
      company: req.user.company,
      active: true
    }));

    const insertedDocs = await Location.insertMany(docsToInsert);

    res.status(201).json({
      success: true,
      message: `Successfully imported all ${insertedDocs.length} locations without errors.`,
      count: insertedDocs.length
    });
  } catch (err) { next(err); }
});

// ── DELETE /api/v1/locations/:id — Disable or Delete Location ──
router.delete('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Location.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Location not found' });
    res.json({ message: 'Location deleted successfully' });
  } catch (err) { next(err); }
});

export default router;
