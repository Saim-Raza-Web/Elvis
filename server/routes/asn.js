import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import Model from '../models/ASN.js';
import Product from '../models/Product.js';
import Incident from '../models/Incident.js';

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
    
    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const wasReceived = existing.status === 'received';
    const isReceived = req.body.status === 'received';

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );
    
    // Physical receiving logic
    if (!wasReceived && isReceived && item.items && item.items.length > 0) {
      for (const row of item.items) {
        if (row.qc_status === 'approved') {
          await Product.findOneAndUpdate(
            { sku: row.sku, company: req.user.company },
            { $inc: { qty_available: row.received_qty } }
          );
        } else if (row.qc_status === 'partial' || row.qc_status === 'rejected') {
          await Incident.create({
            incidentId: `INC-ASN-${Date.now().toString().slice(-6)}`,
            type: row.qc_status === 'partial' ? 'QC Partial' : 'QC Rejected',
            sku: row.sku,
            location: 'Receiving Dock',
            owner: item.owner || 'N/A',
            reported_by: req.user.name,
            description: `ASN ${item.asnId} QC failure: ${row.notes || 'No notes'}`,
            company: req.user.company
          });
          // For partial, we might still want to add the approved portion if we split rows.
          // In a simplified flow, if the row is partial, we assume the received_qty is the approved amount, 
          // but we still logged the incident. Let's add received_qty to stock if partial.
          if (row.qc_status === 'partial' && row.received_qty > 0) {
            await Product.findOneAndUpdate(
              { sku: row.sku, company: req.user.company },
              { $inc: { qty_available: row.received_qty } }
            );
          }
        }
      }
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
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
