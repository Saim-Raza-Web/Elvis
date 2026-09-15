import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { lotRecallService } from '../services/lotRecallService.js';
import AuditLog from '../models/AuditLog.js';

const router = express.Router();
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

/**
 * Shared controller for executing atomic, idempotent lot recall.
 * Invoked by:
 * - POST /api/v1/lot-recalls
 * - POST /api/v1/recall
 * - POST /api/v1/inventory/lots/recall
 */
export async function handleExecuteLotRecall(req, res, next) {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { lotNumber, sku, warehouse, owner, quantity, reason, recallId } = req.body || {};
    if (!lotNumber) {
      return res.status(400).json({ message: 'lotNumber is required for recall' });
    }

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
    if (err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    if (err.status === 409) {
      return res.status(409).json({ message: err.message });
    }
    next(err);
  }
}

// POST /api/v1/lot-recalls — Execute lot recall
router.post('/', requireOpsRole, handleExecuteLotRecall);

// GET /api/v1/lot-recalls — List recent recall audit events
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }
    const query = { company: req.user.company, event_type: 'lot_recalled' };
    if (req.query.lotNumber) query.lot_number = req.query.lotNumber;

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const recalls = await AuditLog.find(query).sort({ timestamp: -1 }).limit(limit);
    res.json({
      success: true,
      count: recalls.length,
      recalls
    });
  } catch (err) {
    next(err);
  }
});

export default router;
