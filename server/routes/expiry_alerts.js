import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { expiryAlertService } from '../services/expiryAlertService.js';
import { expiryWorker } from '../services/expiryWorker.js';

const router = express.Router();

// GET /api/v1/expiry-alerts/cron — Automated Daily Cron Trigger (Vercel Cron / Scheduler)
router.get('/cron', async (req, res, next) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization;

    // Security Guard: In production, CRON_SECRET is strictly required
    if (process.env.NODE_ENV === 'production' && !cronSecret) {
      return res.status(500).json({ message: 'CRON_SECRET environment variable is not configured in production' });
    }

    if (cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ message: 'Unauthorized cron invocation: invalid or missing CRON_SECRET' });
      }
    } else if (authHeader && !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized cron invocation' });
    }

    const result = await expiryWorker.runDailyExpiryWorker({
      dryRun: false,
      evaluationNow: new Date()
    });

    res.json({
      success: true,
      message: 'Daily expiry worker completed successfully',
      executedAt: new Date().toISOString(),
      result
    });
  } catch (err) {
    next(err);
  }
});

router.use(protect);
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

// GET /api/v1/expiry-alerts — List alerts with filtering and pagination
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const companyId = req.user.company;
    const warehouse = req.context?.warehouse?.code || req.query.warehouse;
    const { sku, owner, severity, status, page, limit, sortBy, sortDir } = req.query;

    const result = await expiryAlertService.getAlerts({
      companyId,
      warehouse,
      sku,
      owner,
      severity,
      status,
      page,
      limit,
      sortBy,
      sortDir
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/expiry-alerts/:id — Get alert details
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { default: ExpiryAlert } = await import('../models/ExpiryAlert.js');
    const alert = await ExpiryAlert.findOne({
      _id: req.params.id,
      company: req.user.company
    }).lean();

    if (!alert) {
      return res.status(404).json({ message: 'Expiry alert not found' });
    }

    res.json(alert);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/expiry-alerts/scan — Trigger on-demand expiry evaluation scan (supports dryRun)
router.post('/scan', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const companyId = req.user.company;
    const warehouse = req.context?.warehouse?.code || req.body.warehouse;
    const { dryRun = false, evaluationNow } = req.body;

    const result = await expiryAlertService.scanCompanyExpiry({
      companyId,
      warehouse,
      dryRun: Boolean(dryRun),
      evaluationNow: evaluationNow ? new Date(evaluationNow) : new Date(),
      user: req.user
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/expiry-alerts/:id/acknowledge — Acknowledge an OPEN alert
router.post('/:id/acknowledge', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const updatedAlert = await expiryAlertService.acknowledgeAlert({
      alertId: req.params.id,
      companyId: req.user.company,
      user: req.user,
      note: req.body.note || ''
    });

    res.json({
      success: true,
      message: 'Alert acknowledged successfully',
      alert: updatedAlert
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/expiry-alerts/:id/resolve — Resolve an active alert
router.post('/:id/resolve', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const updatedAlert = await expiryAlertService.resolveAlert({
      alertId: req.params.id,
      companyId: req.user.company,
      user: req.user,
      reason: req.body.reason || 'MANUAL_DISPOSITION'
    });

    res.json({
      success: true,
      message: 'Alert resolved successfully',
      alert: updatedAlert
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/expiry-alerts/:id/dismiss — Dismiss an active alert
router.post('/:id/dismiss', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const updatedAlert = await expiryAlertService.dismissAlert({
      alertId: req.params.id,
      companyId: req.user.company,
      user: req.user,
      reason: req.body.reason || 'SUPERVISOR_DISMISSED'
    });

    res.json({
      success: true,
      message: 'Alert dismissed successfully',
      alert: updatedAlert
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/expiry-alerts/run-worker — Execute scheduled worker shell under distributed lease
router.post('/run-worker', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const companyId = req.user.company;
    const warehouse = req.context?.warehouse?.code || req.body.warehouse;
    const { dryRun = false, evaluationNow } = req.body;

    const result = await expiryWorker.runCompanyWorker({
      companyId,
      warehouse,
      dryRun: Boolean(dryRun),
      evaluationNow: evaluationNow ? new Date(evaluationNow) : new Date()
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
