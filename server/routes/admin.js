import express from 'express';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

router.get('/', (req, res) => {
  res.json({ message: 'admin route works' });
});

export default router;
