import express from 'express';
import { protect } from '../middleware/auth.js';
import User from '../models/User.js';
import Company from '../models/Company.js';

const router = express.Router();

router.use(protect);

router.get('/users', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const users = await User.find({ company: req.user.company }).select('-password');
    res.json(users);
  } catch (err) { next(err); }
});

router.get('/companies', async (req, res, next) => {
  try {
    const companies = await Company.find();
    res.json(companies);
  } catch (err) { next(err); }
});

router.post('/companies', async (req, res, next) => {
  try {
    const company = await Company.create(req.body);
    res.json(company);
  } catch (err) { next(err); }
});

router.put('/companies/:id', async (req, res, next) => {
  try {
    const company = await Company.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(company);
  } catch (err) { next(err); }
});

router.delete('/companies/:id', async (req, res, next) => {
  try {
    await Company.findByIdAndDelete(req.params.id);
    res.json({ message: 'Company deleted' });
  } catch (err) { next(err); }
});

router.get('/metrics', async (req, res) => {
  res.json([
    { label: "API requests (24h)", value: "142,820", change: "+12%", trend: "up" },
    { label: "DB query time (avg)", value: "4.2ms", change: "-8%", trend: "down" },
    { label: "Error rate", value: "0.02%", change: "-0.01%", trend: "down" },
    { label: "Uptime (30d)", value: "99.98%", change: "stable", trend: "stable" }
  ]);
});

export default router;
