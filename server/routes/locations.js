import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { paginateQuery } from '../utils/pagination.js';
import Location from '../models/Location.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import Zone from '../models/Zone.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

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
        { aisle: regex },
        { shelf: regex },
        { bin: regex }
      ];
    }

    if (req.context && req.context.warehouse) {
      if (req.context.warehouse.invalid) {
        query.warehouse = null; // force no results
      } else {
        query.warehouse = req.context.warehouse.id;
      }
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

    if (!req.context || !req.context.warehouse || req.context.warehouse.invalid) {
      return res.status(400).json({ message: 'A valid warehouse is required to create a location.' });
    }

    const resolvedWarehouseId = req.context.warehouse.id;
    const warehouseCode = req.context.warehouse.code;
    const { code, maxUnits = 500, maxWeight = 1000, maxVolume = 10, zoneType = 'AMBIENT', status = 'ACTIVE' } = req.body;

    let finalCode = code && String(code).trim();
    if (!finalCode) {
      if (req.body.zone && req.body.aisle && req.body.shelf) {
        finalCode = `${req.body.zone}-${req.body.aisle}-${req.body.shelf}${req.body.bin ? `-${req.body.bin}` : ''}`;
      } else {
        return res.status(400).json({ message: 'Location code is required (e.g. Z1-A1-R1-S1-B1).' });
      }
    }

    const existing = await Location.findOne({ code: finalCode, warehouse: resolvedWarehouseId, company: req.user.company });
    if (existing) {
      return res.status(400).json({ message: `Location code '${finalCode}' already exists in warehouse ${warehouseCode}.` });
    }

    // Resolve Zone if provided
    let resolvedZoneId = null;
    if (req.body.zone) {
      const zoneInput = String(req.body.zone).trim();
      if (mongoose.Types.ObjectId.isValid(zoneInput) && zoneInput.length === 24) {
        const zoneDoc = await Zone.findOne({ _id: zoneInput, company: req.user.company });
        if (zoneDoc) resolvedZoneId = zoneDoc._id;
      } else {
        const zoneDoc = await Zone.findOne({ code: zoneInput, company: req.user.company, warehouse: resolvedWarehouseId })
          || await Zone.findOne({ code: zoneInput, company: req.user.company });
        if (zoneDoc) resolvedZoneId = zoneDoc._id;
      }
    }

    // Weight limits validation
    let maxWeightKg = undefined;
    if (req.body.max_weight_kg !== undefined && req.body.max_weight_kg !== null && req.body.max_weight_kg !== '') {
      maxWeightKg = Number(req.body.max_weight_kg);
      if (isNaN(maxWeightKg) || maxWeightKg <= 0) {
        return res.status(400).json({ message: 'max_weight_kg must be greater than zero.' });
      }
    } else if (req.body.weight_limit !== undefined && req.body.weight_limit !== null && req.body.weight_limit !== '') {
      maxWeightKg = Number(req.body.weight_limit);
      if (isNaN(maxWeightKg) || maxWeightKg <= 0) {
        return res.status(400).json({ message: 'max_weight_kg must be greater than zero.' });
      }
    }

    let levelWeightLimit = undefined;
    if (req.body.level_weight_limit !== undefined && req.body.level_weight_limit !== null && req.body.level_weight_limit !== '') {
      levelWeightLimit = Number(req.body.level_weight_limit);
      if (isNaN(levelWeightLimit) || levelWeightLimit <= 0) {
        return res.status(400).json({ message: 'level_weight_limit must be greater than zero.' });
      }
    }

    const locationData = {
      ...req.body,
      code: finalCode,
      warehouse: resolvedWarehouseId,
      maxUnits: Number(maxUnits) || 500,
      maxWeight: Number(maxWeight) || 1000,
      maxVolume: Number(maxVolume) || 10,
      zoneType,
      status,
      company: req.user.company
    };

    if (maxWeightKg !== undefined) locationData.max_weight_kg = maxWeightKg;
    if (levelWeightLimit !== undefined) locationData.level_weight_limit = levelWeightLimit;

    if (resolvedZoneId) {
      locationData.zone = resolvedZoneId;
    } else if (req.body.zone && !mongoose.Types.ObjectId.isValid(req.body.zone)) {
      delete locationData.zone;
    }

    // Strip empty-string ObjectId fields — Mongoose cannot cast "" to ObjectId
    if (!locationData.sku || String(locationData.sku).trim() === '') delete locationData.sku;
    if (!locationData.product || String(locationData.product).trim() === '') delete locationData.product;

    const item = await Location.create(locationData);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// ── PUT /api/v1/locations/:id — Edit Location Configuration ──
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const updateData = { ...req.body };

    if (updateData.max_weight_kg !== undefined && updateData.max_weight_kg !== null && updateData.max_weight_kg !== '') {
      updateData.max_weight_kg = Number(updateData.max_weight_kg);
      if (isNaN(updateData.max_weight_kg) || updateData.max_weight_kg <= 0) {
        return res.status(400).json({ message: 'max_weight_kg must be greater than zero.' });
      }
    } else if (updateData.weight_limit !== undefined && updateData.weight_limit !== null && updateData.weight_limit !== '') {
      updateData.max_weight_kg = Number(updateData.weight_limit);
      if (isNaN(updateData.max_weight_kg) || updateData.max_weight_kg <= 0) {
        return res.status(400).json({ message: 'max_weight_kg must be greater than zero.' });
      }
    }

    if (updateData.level_weight_limit !== undefined && updateData.level_weight_limit !== null && updateData.level_weight_limit !== '') {
      updateData.level_weight_limit = Number(updateData.level_weight_limit);
      if (isNaN(updateData.level_weight_limit) || updateData.level_weight_limit <= 0) {
        return res.status(400).json({ message: 'level_weight_limit must be greater than zero.' });
      }
    }

    if (req.context && req.context.warehouse && !req.context.warehouse.invalid) {
      updateData.warehouse = req.context.warehouse.id;
    } else {
      delete updateData.warehouse;
    }

    if (updateData.zone) {
      const zoneInput = String(updateData.zone).trim();
      if (mongoose.Types.ObjectId.isValid(zoneInput) && zoneInput.length === 24) {
        const zoneDoc = await Zone.findOne({ _id: zoneInput, company: req.user.company });
        if (zoneDoc) updateData.zone = zoneDoc._id;
        else delete updateData.zone;
      } else {
        const zoneDoc = await Zone.findOne({ code: zoneInput, company: req.user.company });
        if (zoneDoc) updateData.zone = zoneDoc._id;
        else delete updateData.zone;
      }
    }

    // Strip empty-string ObjectId fields — Mongoose cannot cast "" to ObjectId
    if (!updateData.sku || String(updateData.sku).trim() === '') delete updateData.sku;
    if (!updateData.product || String(updateData.product).trim() === '') delete updateData.product;

    const item = await Location.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      updateData,
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
    const warehouseCodes = new Set();
    const zoneCodes = new Set();

    // Pass 0: Collect unique warehouse and zone codes for lookup
    for (const loc of locations) {
      if (loc.warehouse) warehouseCodes.add(String(loc.warehouse).trim());
      if (loc.zone) zoneCodes.add(String(loc.zone).trim());
    }

    // Lookup valid Warehouses and Zones for this company
    const warehouses = await Warehouse.find({
      company: req.user.company,
      $or: [
        { code: { $in: Array.from(warehouseCodes) } },
        { _id: { $in: Array.from(warehouseCodes).filter(id => mongoose.Types.ObjectId.isValid(id)) } }
      ]
    });
    
    const zones = await Zone.find({
      company: req.user.company,
      $or: [
        { code: { $in: Array.from(zoneCodes) } },
        { _id: { $in: Array.from(zoneCodes).filter(id => mongoose.Types.ObjectId.isValid(id)) } }
      ]
    });

    const whMap = new Map();
    warehouses.forEach(wh => { whMap.set(wh.code, wh._id); whMap.set(String(wh._id), wh._id); });

    const zoneMap = new Map();
    zones.forEach(z => { zoneMap.set(z.code, z._id); zoneMap.set(String(z._id), z._id); });

    const docsToInsert = [];

    // Pass 1: Whole-File Validation (Accumulates ALL errors, 0 partial commits)
    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const rowNum = i + 1;

      if (!loc.code || !String(loc.code).trim()) {
        errors.push(`Row ${rowNum}: Location 'code' is required.`);
        continue;
      }

      const cleanCode = String(loc.code).trim().toUpperCase();
      if (validLocationCodes.has(cleanCode)) {
        errors.push(`Row ${rowNum}: Duplicate location code '${cleanCode}' within CSV file.`);
      }
      validLocationCodes.add(cleanCode);

      // Validate Warehouse
      let resolvedWarehouse = null;
      if (loc.warehouse) {
        resolvedWarehouse = whMap.get(String(loc.warehouse).trim());
        if (!resolvedWarehouse) errors.push(`Row ${rowNum}: Warehouse '${loc.warehouse}' not found or belongs to another tenant.`);
      } else {
        errors.push(`Row ${rowNum}: 'warehouse' is required.`);
      }

      // Validate Zone
      let resolvedZone = null;
      if (loc.zone) {
        resolvedZone = zoneMap.get(String(loc.zone).trim());
        if (!resolvedZone) errors.push(`Row ${rowNum}: Zone '${loc.zone}' not found or belongs to another tenant.`);
      } else {
        errors.push(`Row ${rowNum}: 'zone' is required.`);
      }

      // Storage Rules Validations
      if (loc.tempMin !== undefined && loc.tempMax !== undefined) {
        if (Number(loc.tempMin) > Number(loc.tempMax)) {
          errors.push(`Row ${rowNum}: tempMin (${loc.tempMin}°C) cannot be greater than tempMax (${loc.tempMax}°C).`);
        }
      }

      if (loc.locationType && !['PALLET', 'SHELF', 'FLOOR', 'STAGING', 'OVERFLOW', 'HAZMAT', 'PICK_FACE'].includes(loc.locationType.toUpperCase())) {
        errors.push(`Row ${rowNum}: Invalid locationType '${loc.locationType}'. Allowed: PALLET, SHELF, FLOOR, STAGING, OVERFLOW, HAZMAT, PICK_FACE.`);
      }
      
      if (loc.temperature_type && !['ambient', 'chilled_2_8', 'frozen_minus18', 'controlled_15_25'].includes(loc.temperature_type.toLowerCase())) {
        errors.push(`Row ${rowNum}: Invalid temperature_type '${loc.temperature_type}'. Allowed: ambient, chilled_2_8, frozen_minus18, controlled_15_25.`);
      }

      if (loc.level_weight_limit !== undefined && loc.level_weight_limit !== null && loc.level_weight_limit !== '') {
        const lvlW = Number(loc.level_weight_limit);
        if (isNaN(lvlW) || lvlW <= 0) {
          errors.push(`Row ${rowNum}: level_weight_limit must be greater than zero.`);
        }
      }

      const maxWVal = loc.max_weight_kg !== undefined ? loc.max_weight_kg : loc.weight_limit;
      if (maxWVal !== undefined && maxWVal !== null && maxWVal !== '') {
        const maxW = Number(maxWVal);
        if (isNaN(maxW) || maxW <= 0) {
          errors.push(`Row ${rowNum}: max_weight_kg must be greater than zero.`);
        }
      }

      docsToInsert.push({
        ...loc,
        code: cleanCode,
        warehouse: resolvedWarehouse,
        zone: resolvedZone,
        company: req.user.company,
        active: true,
        // Storage rules fields explicit casting/defaults
        is_pick_face: Boolean(loc.is_pick_face),
        temperature_type: loc.temperature_type ? loc.temperature_type.toLowerCase() : undefined,
        single_lot_enforced: Boolean(loc.single_lot_enforced),
        max_pallets: loc.max_pallets ? Number(loc.max_pallets) : 0,
        max_weight_kg: maxWVal ? Number(maxWVal) : undefined,
        level_weight_limit: loc.level_weight_limit ? Number(loc.level_weight_limit) : undefined,
        min_stock: loc.min_stock ? Number(loc.min_stock) : 0,
        max_stock: loc.max_stock ? Number(loc.max_stock) : 0
      });
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
