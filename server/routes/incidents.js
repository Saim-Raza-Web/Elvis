import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Model from '../models/Incident.js';
import ActivityLog from '../models/ActivityLog.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['incidentId', 'sku', 'type', 'description'],
    });
    const result = await paginateQuery(Model, filter, req, { sort: '-createdAt' });
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
    const incId = req.body.incidentId || ('INC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5));
    const data = { ...req.body, incidentId: incId, company: req.user.company };
    const item = await Model.create(data);
    
    // Log Activity
    await ActivityLog.create({
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      company: req.user.company,
      action: 'Report Incident',
      module: req.body.module || 'Receiving',
      type: 'Incident',
      user: req.user.name || 'system',
      detail: `Reported incident ${item.incidentId}: ${item.reason || item.type}`,
      description: `Reported incident ${item.incidentId}: ${item.reason || item.type}`
    }).catch(() => {});

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    
    const wasResolved = existing.status === 'resolved';
    const isResolved = req.body.status === 'resolved';

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );
    
    if (!wasResolved && isResolved) {
      await ActivityLog.create({
        company: req.user.company,
        type: 'Incident',
        user: req.user.name,
        description: `Resolved incident ${item.incidentId}: ${item.type}`
      });
    }

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
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
