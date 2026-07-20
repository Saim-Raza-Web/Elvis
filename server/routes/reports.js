import express from 'express';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.post('/export', (req, res) => {
  res.json({ message: 'Export initiated successfully' });
});

router.post('/schedule', (req, res) => {
  res.json({ message: 'Report scheduled successfully' });
});

export default router;
