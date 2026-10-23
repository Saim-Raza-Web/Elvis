import express from 'express';
import bcrypt from 'bcryptjs';
import { protect, requireRole } from '../middleware/auth.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Company from '../models/Company.js';
import Warehouse from '../models/Warehouse.js';
import Order from '../models/Order.js';
import ActivityLog from '../models/ActivityLog.js';
import { ROLE_DEFINITIONS } from '../config/permissions.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('admin'));

router.get('/users', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const users = await User.find({ company: req.user.company }).select('-password -totpSecret -totpRecoveryCodes');
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { email, name, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'User with this email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const assignedRole = (role || 'warehouse_staff').trim().toLowerCase();

    // Validate role exists as system role or company custom role
    const isSystemRole = ROLE_DEFINITIONS.some(r => r.id === assignedRole);
    if (!isSystemRole) {
      const customRole = await Role.findOne({ company: req.user.company, roleId: assignedRole });
      if (!customRole) {
        return res.status(400).json({ message: `Role '${assignedRole}' does not exist in this company` });
      }
    }

    const user = await User.create({
      email,
      name: name || email.split('@')[0],
      password: hashedPassword,
      role: assignedRole,
      company: req.user.company,
    });

    await Company.findByIdAndUpdate(req.user.company, { $addToSet: { users: user._id } });
    const safe = await User.findById(user._id).select('-password -totpSecret -totpRecoveryCodes');
    res.status(201).json(safe);
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const { name, role } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) {
      const assignedRole = role.trim().toLowerCase();
      const isSystemRole = ROLE_DEFINITIONS.some(r => r.id === assignedRole);
      if (!isSystemRole) {
        const customRole = await Role.findOne({ company: req.user.company, roleId: assignedRole });
        if (!customRole) {
          return res.status(400).json({ message: `Role '${assignedRole}' does not exist in this company` });
        }
      }

      // Prevent sole admin from demoting themselves
      if (req.params.id === req.user._id.toString() && assignedRole !== 'admin') {
        const adminCount = await User.countDocuments({ company: req.user.company, role: 'admin' });
        if (adminCount <= 1) {
          return res.status(400).json({ message: 'Cannot demote the sole administrator of the company' });
        }
      }

      updates.role = assignedRole;
    }

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      updates,
      { new: true }
    ).select('-password -totpSecret -totpRecoveryCodes');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot remove your own account' });
    }
    const user = await User.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!user) return res.status(404).json({ message: 'User not found' });
    await Company.findByIdAndUpdate(req.user.company, { $pull: { users: user._id } });
    res.json({ message: 'User removed' });
  } catch (err) {
    next(err);
  }
});

router.get('/companies', async (req, res, next) => {
  try {
    const companies = await Company.find();
    res.json(companies);
  } catch (err) {
    next(err);
  }
});

router.post('/companies', async (req, res, next) => {
  try {
    const company = await Company.create(req.body);
    res.status(201).json(company);
  } catch (err) {
    next(err);
  }
});

router.put('/companies/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    // Enforce tenant isolation: admins cannot edit other companies
    if (req.user.company.toString() !== req.params.id) {
      return res.status(403).json({ message: 'Forbidden: You can only edit your own company details' });
    }

    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ message: 'Company name cannot be empty' });
    }

    const allowed = { ...req.body };
    delete allowed._id;
    delete allowed.users; // cannot overwrite users array directly

    const company = await Company.findByIdAndUpdate(req.params.id, allowed, { new: true });
    if (!company) return res.status(404).json({ message: 'Company not found' });
    res.json(company);
  } catch (err) {
    next(err);
  }
});

router.delete('/companies/:id', async (req, res, next) => {
  try {
    await Company.findByIdAndDelete(req.params.id);
    res.json({ message: 'Company deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/metrics', async (req, res, next) => {
  try {
    const comp = req.user.company;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [userCount, warehouseCount, orderCount, recentLogs] = await Promise.all([
      User.countDocuments({ company: comp }),
      Warehouse.countDocuments({ company: comp }),
      Order.countDocuments({ company: comp, createdAt: { $gte: since } }),
      ActivityLog.countDocuments({ company: comp, createdAt: { $gte: since } }),
    ]);

    res.json([
      { label: 'Team members', value: String(userCount), change: 'live', trend: 'stable' },
      { label: 'Warehouses', value: String(warehouseCount), change: 'live', trend: 'stable' },
      { label: 'Orders (24h)', value: String(orderCount), change: 'live', trend: orderCount > 0 ? 'up' : 'stable' },
      { label: 'Activity events (24h)', value: String(recentLogs), change: 'live', trend: 'stable' },
    ]);
  } catch (err) {
    next(err);
  }
});

export default router;
