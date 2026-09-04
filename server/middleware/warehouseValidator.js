import mongoose from 'mongoose';
import Warehouse from '../models/Warehouse.js';

// Recursive warehouse search removed to prevent nested context bleed vulnerability.

export const validateWarehouse = async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Collect explicitly declared top-level warehouse candidates
    const inputs = new Set();
    
    if (req.params.warehouse) inputs.add(String(req.params.warehouse).trim());
    if (req.query.warehouse) inputs.add(String(req.query.warehouse).trim());
    if (req.body && req.body.warehouse) inputs.add(String(req.body.warehouse).trim());

    if (inputs.size === 0) {
      return next(); // Proceed without validation if no warehouse is provided
    }

    // Validate ALL collected warehouses
    const inputsArray = Array.from(inputs);
    const validWarehouses = [];

    for (const warehouseInput of inputsArray) {
      const searchQuery = { company: req.user.company };
      
      if (mongoose.Types.ObjectId.isValid(warehouseInput) && String(warehouseInput).length === 24) {
        searchQuery._id = warehouseInput;
      } else {
        searchQuery.code = warehouseInput;
      }

      const warehouse = await Warehouse.findOne(searchQuery);

      if (!warehouse) {
        return res.status(400).json({ 
          error: 'INVALID_WAREHOUSE', 
          message: `Invalid warehouse code or ID '${warehouseInput}' for this tenant.` 
        });
      }

      validWarehouses.push({
        id: warehouse._id,
        code: warehouse.code,
        company: warehouse.company,
        invalid: false
      });
    }

    req.context = req.context || {};
    req.context.warehouses = validWarehouses;
    
    // For single-warehouse routes, provide the first one as req.context.warehouse
    // If they have multiple warehouses, it's fine; if a route requires only 1, the route should enforce it.
    if (validWarehouses.length > 0) {
      req.context.warehouse = validWarehouses[0];
    }

    next();
  } catch (err) {
    next(err);
  }
};
