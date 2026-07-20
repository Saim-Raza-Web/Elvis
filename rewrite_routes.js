import fs from 'fs';
import path from 'path';

const routeToModel = {
  'warehouses': 'Warehouse',
  'locations': 'Location',
  'inventory': 'Product',
  'receiving': 'Receipt',
  'asn': 'ASN',
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
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const items = await Model.find({ company: req.user.company });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const data = { ...req.body, company: req.user.company };
    const item = await Model.create(data);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// UPDATE
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company }, 
      req.body, 
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndDelete({ _id: req.params.id, company: req.user.company });
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
