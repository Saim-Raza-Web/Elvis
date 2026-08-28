import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { canAccessModule } from '../config/permissions.js';

export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret_key';
    const decoded = jwt.verify(token, secret);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ message: 'User belonging to this token no longer exists' });
    }
    if (!req.user.company) {
      const Company = (await import('../models/Company.js')).default;
      const fallbackCompany = await Company.findOne({});
      if (fallbackCompany) {
        req.user.company = fallbackCompany._id;
      }
    }
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: `Access denied. Required role: ${roles.join(' or ')}` });
  }
  next();
};

export const requireModuleAccess = (module) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }
  if (!canAccessModule(req.user.role, module)) {
    return res.status(403).json({ message: `Access denied to ${module}` });
  }
  next();
};
