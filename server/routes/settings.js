import express from 'express';
import { protect } from '../middleware/auth.js';
import Company from '../models/Company.js';

const router = express.Router();

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const company = await Company.findById(req.user.company);
    res.json(company || {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const company = await Company.findByIdAndUpdate(req.user.company, req.body, { new: true, runValidators: true });
    res.json(company);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/apikeys', async (req, res) => {
  try {
    const key = "elvis_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const company = await Company.findByIdAndUpdate(
      req.user.company,
      { $push: { apiKeys: { name: req.body.name, key: key, lastUsed: null } } },
      { new: true }
    );
    res.json(company.apiKeys);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/apikeys/:id', async (req, res) => {
  try {
    const company = await Company.findByIdAndUpdate(
      req.user.company,
      { $pull: { apiKeys: { _id: req.params.id } } },
      { new: true }
    );
    res.json(company.apiKeys);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
