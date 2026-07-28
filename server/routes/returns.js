import express from 'express';
import { protect } from '../middleware/auth.js';
import Model from '../models/Return.js';
import Product from '../models/Product.js';
import Incident from '../models/Incident.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const items = await Model.find({ company: req.user.company });
    res.json(items);
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
router.post('/', async (req, res, next) => {
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
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const wasProcessed = existing.status === 'processed' || existing.status === 'refunded';
    const isProcessed = req.body.status === 'processed' || req.body.status === 'refunded';

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );

    // If newly processed, process items_details for restock vs block
    if (!wasProcessed && isProcessed && item.items_details && item.items_details.length > 0) {
      for (const row of item.items_details) {
        if (row.qc_status === 'restock') {
          await Product.findOneAndUpdate(
            { sku: row.sku, company: req.user.company },
            { $inc: { qty_available: row.qty } }
          );
        } else if (row.qc_status === 'disposed' || row.qc_status === 'rejected') {
          // Add to blocked stock
          await Product.findOneAndUpdate(
            { sku: row.sku, company: req.user.company },
            { $inc: { qty_blocked: row.qty } }
          );
          
          // Create incident
          await Incident.create({
            incidentId: `INC-RET-${Date.now().toString().slice(-6)}`,
            type: 'Damage',
            sku: row.sku,
            location: 'Returns Zone',
            owner: 'N/A', // or item.customer
            reported_by: req.user.name,
            description: `Return ${item.returnId} items rejected/damaged: ${row.reason}`,
            company: req.user.company
          });
        }
      }
    } else if (!wasProcessed && isProcessed && (!item.items_details || item.items_details.length === 0) && item.items > 0) {
      // Fallback for legacy returns without items_details
      const product = await Product.findOne({ company: req.user.company });
      if (product) {
        await Product.findByIdAndUpdate(product._id, {
          $inc: { qty_available: item.items }
        });
      }
    }

    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
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
