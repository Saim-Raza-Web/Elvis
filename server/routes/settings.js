import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import Company from '../models/Company.js';
import Warehouse from '../models/Warehouse.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

const router = express.Router();

const PLAN_LIMITS = {
  starter: { warehouses: 2, orders: 500, team: 2 },
  professional: { warehouses: 10, orders: 5000, team: 10 },
  enterprise: { warehouses: 999, orders: 999999, team: 999 },
  free: { warehouses: 1, orders: 100, team: 1 },
};

router.use(protect);

router.get('/', async (req, res, next) => {
  try {
    const company = await Company.findById(req.user.company);
    res.json(company || {});
  } catch (error) {
    next(error);
  }
});

router.get('/usage', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const comp = req.user.company;
    const company = await Company.findById(comp);
    const plan = (company?.plan || 'starter').toLowerCase();
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [warehouses, ordersThisMonth, teamMembers] = await Promise.all([
      Warehouse.countDocuments({ company: comp }),
      Order.countDocuments({ company: comp, createdAt: { $gte: monthStart } }),
      User.countDocuments({ company: comp }),
    ]);

    res.json({
      warehouses: { used: warehouses, limit: limits.warehouses },
      orders: { used: ordersThisMonth, limit: limits.orders },
      team: { used: teamMembers, limit: limits.team },
      plan,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/', requireRole('admin'), async (req, res, next) => {
  try {
    const company = await Company.findByIdAndUpdate(req.user.company, req.body, { new: true, runValidators: true });
    res.json(company);
  } catch (error) {
    next(error);
  }
});

router.post('/apikeys', requireRole('admin'), async (req, res, next) => {
  try {
    const key = 'elvis_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const company = await Company.findByIdAndUpdate(
      req.user.company,
      { $push: { apiKeys: { name: req.body.name, key, lastUsed: null } } },
      { new: true }
    );
    res.json(company.apiKeys);
  } catch (error) {
    next(error);
  }
});

router.delete('/apikeys/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const company = await Company.findByIdAndUpdate(
      req.user.company,
      { $pull: { apiKeys: { _id: req.params.id } } },
      { new: true }
    );
    res.json(company.apiKeys);
  } catch (error) {
    next(error);
  }
});

export default router;
