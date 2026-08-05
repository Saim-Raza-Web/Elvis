import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Location from '../models/Location.js';

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
