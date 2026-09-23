import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { handleExecuteLotRecall, handleLotRecallPreview, handleShippedOrdersReport } from './lot_recalls.js';

const router = express.Router();
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

router.get('/preview', handleLotRecallPreview);
router.get('/shipped-report', handleShippedOrdersReport);

// POST /api/v1/recall — Thin compatibility alias delegating to canonical lot recall
router.post('/', requireOpsRole, handleExecuteLotRecall);

export default router;
