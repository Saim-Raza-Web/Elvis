import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { canAccessModule } from '../config/permissions.js';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] JWT_SECRET environment variable is not configured in production');
    }
    return 'fallback_secret_key';
  }
  return secret;
}

export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ message: 'User belonging to this token no longer exists' });
    }
    if (!req.user.company) {
      return res.status(403).json({ message: 'User has no associated company context' });
    }
    next();
  } catch (error) {
    if (error.message && error.message.includes('[FATAL] JWT_SECRET')) {
      return res.status(500).json({ message: error.message });
    }
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
