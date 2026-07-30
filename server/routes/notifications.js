import express from 'express';
import { protect } from '../middleware/auth.js';
import Notification from '../models/Notification.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

// GET all for current user/company
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    // Get notifications for this company, where user is either null (broadcast) or matches the current user
    const query = {
      company: req.user.company,
      $or: [{ user: null }, { user: req.user._id }]
    };
    
    const notifications = await Notification.find(query)
      .sort('-createdAt')
      .limit(50)
      .lean();
      
    // Transform id
    const results = notifications.map(n => ({
      ...n,
      id: n._id.toString(),
      created_at: n.createdAt
    }));

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// Mark as read
router.put('/:id/read', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      { read_at: new Date() },
      { new: true }
    );
    
    if (!notification) return res.status(404).json({ message: 'Not found' });
    res.json(notification);
  } catch (err) {
    next(err);
  }
});

// Mark all as read
router.put('/read-all', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const query = {
      company: req.user.company,
      $or: [{ user: null }, { user: req.user._id }],
      read_at: null
    };
    
    await Notification.updateMany(query, { read_at: new Date() });
    res.json({ message: 'All marked as read' });
  } catch (err) {
    next(err);
  }
});

export default router;
