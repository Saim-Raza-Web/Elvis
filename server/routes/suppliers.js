import express from 'express';
import Supplier from '../models/Supplier.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

const DEFAULT_SUPPLIERS = [
  { name: 'Acme Global Suppliers', taxId: 'TAX-001', country: 'Spain', contact: 'Carlos Rodriguez', defaultCarrier: 'DHL Express', leadTime: 7 },
  { name: 'TechParts International', taxId: 'TAX-002', country: 'Germany', contact: 'Hans Schmidt', defaultCarrier: 'FedEx', leadTime: 10 },
  { name: 'Logistics Direct SA', taxId: 'TAX-003', country: 'France', contact: 'Jean Dupont', defaultCarrier: 'SEUR', leadTime: 5 }
];

// GET all suppliers
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    let suppliers = await Supplier.find({ company: req.user.company }).sort({ name: 1 });

    if (suppliers.length === 0) {
      const seedData = DEFAULT_SUPPLIERS.map(s => ({ ...s, company: req.user.company }));
      try {
        await Supplier.insertMany(seedData, { ordered: false });
        suppliers = await Supplier.find({ company: req.user.company }).sort({ name: 1 });
      } catch (_) {
        suppliers = await Supplier.find({ company: req.user.company }).sort({ name: 1 });
      }
    }

    res.json(suppliers);
  } catch (err) {
    next(err);
  }
});

// POST create supplier
router.post('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { name, taxId, country, contact, email, phone, defaultCarrier, leadTime } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Supplier name is required' });

    const existing = await Supplier.findOne({ company: req.user.company, name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: `Supplier '${name.trim()}' already exists.` });
    }

    const supplier = await Supplier.create({
      name: name.trim(),
      taxId: taxId || '',
      country: country || 'Spain',
      contact: contact || '',
      email: email || '',
      phone: phone || '',
      defaultCarrier: defaultCarrier || '',
      leadTime: Number(leadTime) || 7,
      company: req.user.company
    });

    res.status(201).json(supplier);
  } catch (err) {
    next(err);
  }
});

// PUT update supplier
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const supplier = await Supplier.findOne({ _id: req.params.id, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    const { name, taxId, country, contact, email, phone, defaultCarrier, leadTime } = req.body;
    if (name) supplier.name = name.trim();
    if (taxId !== undefined) supplier.taxId = taxId;
    if (country !== undefined) supplier.country = country;
    if (contact !== undefined) supplier.contact = contact;
    if (email !== undefined) supplier.email = email;
    if (phone !== undefined) supplier.phone = phone;
    if (defaultCarrier !== undefined) supplier.defaultCarrier = defaultCarrier;
    if (leadTime !== undefined) supplier.leadTime = Number(leadTime);

    await supplier.save();
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

// DELETE supplier
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const supplier = await Supplier.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    res.json({ message: `Supplier '${supplier.name}' deleted successfully` });
  } catch (err) {
    next(err);
  }
});

export default router;
