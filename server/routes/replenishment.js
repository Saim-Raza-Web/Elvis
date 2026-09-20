import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { replenishmentEngine } from '../services/replenishmentEngine.js';
import WarehouseTask from '../models/WarehouseTask.js';

const router = express.Router();
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

// GET /api/v1/replenishment/tasks — List replenishment tasks
router.get('/tasks', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }
    const query = { company: req.user.company, task_type: 'replenishment' };
    const warehouse = req.query.warehouse || req.context?.warehouse?.code;
    if (warehouse) query.warehouse = warehouse;
    if (req.query.status) query.status = req.query.status;

    const tasks = await WarehouseTask.find(query).sort({ priority: 1, createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/replenishment/evaluate — Evaluate warehouse pick faces
router.post('/evaluate', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }
    const warehouse = req.body.warehouse || req.context?.warehouse?.code || req.headers['x-warehouse-code'] || 'MIA';
    const dryRun = Boolean(req.body.dryRun);

    if (dryRun) {
      const sim = await replenishmentEngine.simulateReplenishment(req.user.company, warehouse);
      return res.json(sim);
    }

    const evalResult = await replenishmentEngine.evaluateWarehouse(req.user.company, warehouse);
    res.json(evalResult);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/replenishment/reserve — Reserve replenishment inventory
router.post('/reserve', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    const warehouse = req.body.warehouse || req.context?.warehouse?.code || req.headers['x-warehouse-code'] || 'MIA';

    const result = await replenishmentEngine.reserveReplenishment(req.user.company, {
      ...req.body,
      warehouse,
      user: req.user?.name || 'system',
      idempotencyKey
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/replenishment/:id/complete — Complete physical replenishment
router.post('/:id/complete', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }
    const result = await replenishmentEngine.completeReplenishment(
      req.user.company,
      req.params.id,
      req.user?.name || 'system'
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/replenishment/:id/cancel — Cancel replenishment task
router.post('/:id/cancel', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }
    const result = await replenishmentEngine.cancelReplenishment(
      req.user.company,
      req.params.id,
      req.user?.name || 'system'
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/replenishment/cron — Trigger auto-replenishment scheduler (Vercel Cron / admin)
router.post('/cron', async (req, res, next) => {
  try {
    const { replenishmentScheduler } = await import('../services/replenishmentScheduler.js');
    const tasks = await replenishmentScheduler.run();
    res.json({
      success: true,
      message: `Auto-replenishment scan completed. Generated ${tasks.length} task(s).`,
      tasks
    });
  } catch (err) {
    next(err);
  }
});

export default router;
