import express from 'express';
import ProductCategory from '../models/ProductCategory.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

const DEFAULT_CATEGORIES = [
  { code: 'FOOD-DRY', name: 'Dry Food', qc_behaviour: 'Standard + expiry date', recommended_zone: 'Dry zone (ambient temp)', description: 'Ambient dry food items' },
  { code: 'COLD', name: 'Cold Chain', qc_behaviour: 'Cold Chain: temp + humidity + data logger', recommended_zone: 'Refrigerated / frozen zone', description: 'Temperature controlled refrigerated items' },
  { code: 'BEVERAGE', name: 'Beverages', qc_behaviour: 'Standard + pallet weight', recommended_zone: 'Heavy goods or floor zone', description: 'Bottled and canned beverages' },
  { code: 'PHARMA', name: 'Pharma', qc_behaviour: 'Mandatory lot + qualified inspector', recommended_zone: 'Segregated / controlled zone', description: 'Pharmaceutical and medical supplies' },
  { code: 'HAZMAT', name: 'Hazardous Goods', qc_behaviour: 'Mandatory safety data sheet', recommended_zone: 'Segregated HAZMAT zone', description: 'Hazardous or chemical materials' },
  { code: 'GEN', name: 'General', qc_behaviour: 'Standard', recommended_zone: 'Any available zone', description: 'General ambient merchandise' }
];

// GET all categories
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    let categories = await ProductCategory.find({ company: req.user.company }).sort({ code: 1 });

    if (categories.length === 0) {
      const seedData = DEFAULT_CATEGORIES.map(c => ({ ...c, company: req.user.company }));
      try {
        await ProductCategory.insertMany(seedData, { ordered: false });
        categories = await ProductCategory.find({ company: req.user.company }).sort({ code: 1 });
      } catch (_) {
        categories = await ProductCategory.find({ company: req.user.company }).sort({ code: 1 });
      }
    }

    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// POST create category
router.post('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { code, name, qc_behaviour, recommended_zone, description, active } = req.body;
    if (!code || !code.trim()) return res.status(400).json({ message: 'Category code is required.' });
    if (!name || !name.trim()) return res.status(400).json({ message: 'Category name is required.' });

    const codeUpper = code.trim().toUpperCase();
    const existing = await ProductCategory.findOne({ company: req.user.company, code: codeUpper });
    if (existing) {
      return res.status(400).json({ message: `Category code '${codeUpper}' already exists.` });
    }

    const category = await ProductCategory.create({
      code: codeUpper,
      name: name.trim(),
      qc_behaviour: qc_behaviour || 'Standard',
      recommended_zone: recommended_zone || 'Any available zone',
      description: description || '',
      active: active !== undefined ? Boolean(active) : true,
      company: req.user.company
    });

    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

// PUT update category
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const category = await ProductCategory.findOne({ _id: req.params.id, company: req.user.company });
    if (!category) return res.status(404).json({ message: 'Category not found' });

    const { code, name, qc_behaviour, recommended_zone, description, active } = req.body;
    if (code && code.trim().toUpperCase() !== category.code) {
      const codeUpper = code.trim().toUpperCase();
      const existing = await ProductCategory.findOne({ company: req.user.company, code: codeUpper, _id: { $ne: category._id } });
      if (existing) return res.status(400).json({ message: `Category code '${codeUpper}' already exists.` });
      category.code = codeUpper;
    }

    if (name !== undefined) category.name = name.trim();
    if (qc_behaviour !== undefined) category.qc_behaviour = qc_behaviour;
    if (recommended_zone !== undefined) category.recommended_zone = recommended_zone;
    if (description !== undefined) category.description = description;
    if (active !== undefined) category.active = Boolean(active);

    await category.save();
    res.json(category);
  } catch (err) {
    next(err);
  }
});

// DELETE category
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const category = await ProductCategory.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!category) return res.status(404).json({ message: 'Category not found' });

    res.json({ message: `Product Category '${category.code}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

export default router;
