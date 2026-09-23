import express from 'express';
import { protect, requireRole, requireModuleAccess } from '../middleware/auth.js';
import { abcEngine } from '../services/abcEngine.js';
import Product from '../models/Product.js';
import AuditLog from '../models/AuditLog.js';
import WorkerLease from '../models/WorkerLease.js';

const router = express.Router();
const requireOpsRole = requireRole('admin', 'manager');

/**
 * Recalculate ABC classification handler
 * Supports:
 * 1. Automated Weekly Vercel Cron invocation via Authorization: Bearer <CRON_SECRET>
 *    - Distributed concurrency locking via WorkerLease
 *    - Iterates all companies via abcEngine.runWeeklyAbcWorker()
 *    - Audit logging
 * 2. Authenticated user recalculation via JWT (admin/manager role required)
 *    - Computes ABC for the user's company
 *    - Audit logging
 */
async function handleRecalculate(req, res, next) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization;

    // Check if this is an attempted CRON invocation:
    // Either HTTP GET (Vercel Cron default) or authHeader matching CRON_SECRET
    const isCronAttempt = req.method === 'GET' || (cronSecret && authHeader === `Bearer ${cronSecret}`);

    if (isCronAttempt) {
      if (process.env.NODE_ENV === 'production' && !cronSecret) {
        return res.status(500).json({ message: 'CRON_SECRET environment variable is not configured in production' });
      }

      if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ message: 'Unauthorized cron invocation: invalid or missing CRON_SECRET' });
      }

      // CRON execution path: Distributed concurrency lock via WorkerLease
      const now = new Date();
      const leaseDurationMs = 5 * 60 * 1000;
      const lockedUntil = new Date(now.getTime() + leaseDurationMs);
      const owner = `cron_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
      const jobKey = 'ABC_RECALCULATION_WORKER';

      let lease = await WorkerLease.findOneAndUpdate(
        {
          jobKey,
          $or: [
            { status: 'RELEASED' },
            { leaseUntil: { $lte: now } }
          ]
        },
        {
          $set: {
            status: 'ACQUIRED',
            leaseOwner: owner,
            leaseUntil: lockedUntil,
            lastHeartbeat: now
          }
        },
        { returnDocument: 'after' }
      );

      if (!lease) {
        const existingLease = await WorkerLease.findOne({ jobKey });
        if (existingLease && existingLease.status === 'ACQUIRED' && existingLease.leaseUntil > now) {
          return res.status(409).json({
            success: false,
            message: 'ABC recalculation already in progress',
            status: 'CONCURRENT_RUN_PREVENTED'
          });
        }

        try {
          lease = await WorkerLease.create({
            jobKey,
            leaseOwner: owner,
            leaseUntil: lockedUntil,
            status: 'ACQUIRED',
            lastHeartbeat: now
          });
        } catch (err) {
          if (err.code === 11000) {
            return res.status(409).json({
              success: false,
              message: 'ABC recalculation already in progress',
              status: 'CONCURRENT_RUN_PREVENTED'
            });
          }
          throw err;
        }
      }

      let results;
      try {
        results = await abcEngine.runWeeklyAbcWorker();
        await WorkerLease.updateOne(
          { jobKey, leaseOwner: owner },
          {
            $set: {
              status: 'RELEASED',
              lastRunAt: new Date(),
              lastRunStatus: 'SUCCESS',
              lastRunDurationMs: Date.now() - now.getTime()
            }
          }
        );
      } catch (calcErr) {
        await WorkerLease.updateOne(
          { jobKey, leaseOwner: owner },
          {
            $set: {
              status: 'RELEASED',
              lastRunAt: new Date(),
              lastRunStatus: 'FAILED',
              lastRunDurationMs: Date.now() - now.getTime()
            }
          }
        );
        throw calcErr;
      }

      // Log audit entry per company
      for (const compRes of results) {
        if (compRes.companyId) {
          await AuditLog.create({
            event_id: `ABC-CRON-${Date.now()}-${compRes.companyId}`,
            event_type: 'abc_calculated',
            user_name: 'CRON_SCHEDULER',
            company: compRes.companyId,
            new_value: {
              summary: compRes.summary,
              status: compRes.status,
              executedAt: new Date().toISOString()
            }
          });
        }
      }

      return res.json({
        success: true,
        message: 'Weekly ABC classification completed successfully',
        executedAt: new Date().toISOString(),
        results
      });
    }

    // Normal authenticated/manual API route behavior:
    protect(req, res, () => {
      requireOpsRole(req, res, async () => {
        try {
          if (!req.user || !req.user.company) {
            return res.status(403).json({ message: 'Company context required' });
          }

          const { referenceDate } = req.body || {};
          const refDate = referenceDate ? new Date(referenceDate) : new Date();

          const result = await abcEngine.calculateCompanyABC(req.user.company, refDate);

          await AuditLog.create({
            event_id: `ABC-CALC-${Date.now()}`,
            event_type: 'abc_calculated',
            user_id: req.user._id,
            user_name: req.user.name || req.user.email,
            company: req.user.company,
            new_value: {
              totalProducts: result.totalProducts,
              counts: result.counts,
              referenceDate: refDate
            }
          });

          return res.json(result);
        } catch (innerErr) {
          next(innerErr);
        }
      });
    });
  } catch (err) {
    next(err);
  }
}

// Recalculation endpoints (supporting Vercel cron and manual trigger)
router.all('/recalculate', handleRecalculate);
router.all('/cron', handleRecalculate);

// Require authentication and inventory module access for all subsequent routes
router.use(protect);
router.use(requireModuleAccess('inventory'));

// GET /api/v1/abc-classification — Get ABC classification summary & products
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const products = await Product.find(
      { company: req.user.company },
      'sku name category sku_abc_class abc_calc_date abc_pick_count_period abc_class_override'
    ).sort({ abc_pick_count_period: -1, sku: 1 });

    const counts = { A: 0, B: 0, C: 0 };
    const productList = products.map(p => {
      const effClass = p.abc_class_override || p.sku_abc_class || 'C';
      if (counts[effClass] !== undefined) counts[effClass]++;
      return {
        _id: p._id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        calculatedClass: p.sku_abc_class || 'C',
        effectiveClass: effClass,
        volume: p.abc_pick_count_period || 0,
        calcDate: p.abc_calc_date || null,
        hasOverride: Boolean(p.abc_class_override),
        override: p.abc_class_override || null
      };
    });

    res.json({
      totalProducts: products.length,
      counts,
      products: productList
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/abc-classification/:sku/override — Set manual ABC override
router.put('/:sku/override', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { sku } = req.params;
    const { abcClass, reason } = req.body || {};

    // Validate ABC class
    if (!abcClass || !['A', 'B', 'C'].includes(abcClass)) {
      return res.status(400).json({ message: 'Invalid ABC class. Must be A, B, or C.' });
    }

    // Find product
    const product = await Product.findOne({
      company: req.user.company,
      sku: sku
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Store previous value for audit
    const previousValue = {
      calculatedClass: product.sku_abc_class,
      previousOverride: product.abc_class_override,
      previousReason: product.abc_override_reason
    };

    // Update product with override
    product.abc_class_override = abcClass;
    product.abc_override_reason = reason || '';
    product.abc_override_set_by = req.user._id;
    await product.save();

    // Audit log for ABC override
    await AuditLog.create({
      event_id: `ABC-OVERRIDE-${Date.now()}`,
      event_type: 'abc_override_set',
      user_id: req.user._id,
      user_name: req.user.name || req.user.email,
      sku: product._id,
      previous_value: previousValue,
      new_value: {
        override: abcClass,
        reason: reason || '',
        effectiveClass: abcClass
      },
      reason_text: reason || '',
      company: req.user.company
    });

    res.json({
      success: true,
      sku: product.sku,
      calculatedClass: product.sku_abc_class,
      override: product.abc_class_override,
      effectiveClass: product.abc_class_override || product.sku_abc_class,
      reason: product.abc_override_reason
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/abc-classification/:sku/override — Clear manual ABC override
router.delete('/:sku/override', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { sku } = req.params;

    // Find product
    const product = await Product.findOne({
      company: req.user.company,
      sku: sku
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (!product.abc_class_override) {
      return res.status(400).json({ message: 'No override exists for this product' });
    }

    // Store previous value for audit
    const previousValue = {
      override: product.abc_class_override,
      reason: product.abc_override_reason,
      effectiveClass: product.abc_class_override || product.sku_abc_class
    };

    // Clear override
    product.abc_class_override = null;
    product.abc_override_reason = null;
    product.abc_override_set_by = null;
    await product.save();

    // Audit log for ABC override clear
    await AuditLog.create({
      event_id: `ABC-OVERRIDE-CLEAR-${Date.now()}`,
      event_type: 'abc_override_cleared',
      user_id: req.user._id,
      user_name: req.user.name || req.user.email,
      sku: product._id,
      previous_value: previousValue,
      new_value: {
        effectiveClass: product.sku_abc_class
      },
      company: req.user.company
    });

    res.json({
      success: true,
      sku: product.sku,
      calculatedClass: product.sku_abc_class,
      effectiveClass: product.sku_abc_class,
      message: 'Override cleared successfully'
    });
  } catch (err) {
    next(err);
  }
});

export default router;
