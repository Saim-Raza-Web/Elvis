import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { handleExecuteLotRecall } from './lot_recalls.js';

const router = express.Router();
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

// POST /api/v1/recall — Thin compatibility alias delegating to canonical lot recall
router.post('/', requireOpsRole, handleExecuteLotRecall);

export default router;
