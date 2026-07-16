import fs from 'fs';
import path from 'path';

const routeToModel = {
  'warehouses': 'Warehouse',
  'locations': 'Location',
  'inventory': 'Product',
  'receiving': 'Receipt',
  'transfers': 'Transfer',
  'picking': 'PickTask',
  'packing': 'PackTask',
  'orders': 'Order',
  'ecommerce': 'EcommerceChannel',
  'shipping': 'Shipment',
  'carriers': 'Carrier',
  'returns': 'Return',
  'crm': 'Customer',
  'billing': 'Invoice',
  'accounting': 'Transaction',
  'activity': 'ActivityLog'
};

const routesDir = path.join(process.cwd(), 'server', 'routes');

for (const [routeName, modelName] of Object.entries(routeToModel)) {
  const content = `import express from 'express';
import { protect } from '../middleware/auth.js';
import Model from '../models/${modelName}.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

// GET all
router.get('/', async (req, res, next) => {
  try {
    const items = await Model.find();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    const item = await Model.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', async (req, res, next) => {
  try {
    const item = await Model.create(req.body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE
router.put('/:id', async (req, res, next) => {
  try {
    const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
  try {
    const item = await Model.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
`;

  fs.writeFileSync(path.join(routesDir, `${routeName}.js`), content);
}

console.log('Routes successfully rewritten with CRUD logic!');
