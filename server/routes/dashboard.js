import express from 'express';
import { protect } from '../middleware/auth.js';
import kpiRouter from './kpi.js';

const router = express.Router();

router.use(protect);

// Forward root GET /api/v1/dashboard to the KPI summary aggregator
router.use('/', kpiRouter);

export default router;
