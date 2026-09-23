import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Warehouse from '../models/Warehouse.js';
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

/**
 * CLIENT_3PL Authorization Middleware
 * Verifies client_3pl user can only access their own client's data and allowed warehouses
 */
export const requireClientAccess = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  if (req.user.role !== 'client_3pl') {
    return next(); // Not a client_3pl user, skip this check
  }

  if (!req.user.clientId) {
    return res.status(403).json({ message: 'Client 3PL user must have an associated client' });
  }

  try {
    // Verify client exists and is active
    const client = await Client.findOne({ _id: req.user.clientId, company: req.user.company });
    if (!client) {
      return res.status(403).json({ message: 'Associated client not found or does not belong to your company' });
    }
    if (!client.active) {
      return res.status(403).json({ message: 'Associated client is inactive' });
    }

    // Verify warehouse access if warehouse is specified in context
    if (req.context && req.context.warehouse && req.context.warehouse.code) {
      const warehouseCode = req.context.warehouse.code;
      if (!client.warehouseAccess.includes(warehouseCode)) {
        return res.status(403).json({ message: `Access denied to warehouse '${warehouseCode}' for your client` });
      }
    }

    // Verify owner isolation for data access
    // The owner field in inventory/orders should match the client's name
    if (req.body.owner && req.body.owner !== client.name) {
      return res.status(403).json({ message: 'Client 3PL users can only access their own owner data' });
    }

    // Attach client context for downstream use
    req.clientContext = {
      clientId: client._id,
      clientName: client.name,
      warehouseAccess: client.warehouseAccess
    };

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Authorization check failed' });
  }
};

/**
 * MANAGEMENT Authorization Middleware
 * Verifies management user can only access their assigned warehouse(s)
 */
export const requireWarehouseScopedManager = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  if (req.user.role !== 'management') {
    return next(); // Not a management user, skip this check
  }

  if (!req.user.warehouses || req.user.warehouses.length === 0) {
    return res.status(403).json({ message: 'Management user must have at least one assigned warehouse' });
  }

  try {
    // Verify warehouse access if warehouse is specified in context
    if (req.context && req.context.warehouse && req.context.warehouse.id) {
      const warehouseId = req.context.warehouse.id;

      // Check if the requested warehouse is in the user's assigned warehouses
      const hasAccess = req.user.warehouses.some(whId => {
        return String(whId) === String(warehouseId);
      });

      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied: warehouse not in your assigned scope' });
      }
    }

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Authorization check failed' });
  }
};

/**
 * OFFICE Authorization Middleware
 * Blocks office users from warehouse execution operations
 */
export const requireOfficeAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  if (req.user.role !== 'office') {
    return next(); // Not an office user, skip this check
  }

  // Office users are allowed: dashboard, orders, reports
  // These are handled by requireModuleAccess
  // This middleware is used to explicitly block warehouse execution routes
  return res.status(403).json({ message: 'Office users do not have access to warehouse execution operations' });
};
