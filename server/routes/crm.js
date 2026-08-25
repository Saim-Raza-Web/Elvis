import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Customer from '../models/Customer.js';
import { isValidEmail } from '../services/emailService.js';

const router = express.Router();
router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['name', 'contact', 'email', 'vatNumber', 'phone', 'country'],
      exact: { status: 'status', tier: 'tier', active: 'active' }
    });
    const result = await paginateQuery(Customer, filter, req);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Customer.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Customer not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// CREATE Customer
router.post('/', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    
    const { name, email, vatNumber, contact, phone, country, billingAddress, shippingAddress, paymentTerms, iban, bankInfo, tier, notes, active, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Customer / Company name is required.' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Customer email address is required.' });
    }

    if (!isValidEmail(email.trim())) {
      return res.status(400).json({ message: `Invalid email format: '${email}'.` });
    }

    if (vatNumber && vatNumber.trim()) {
      const existingVat = await Customer.findOne({ company: req.user.company, vatNumber: vatNumber.trim() });
      if (existingVat) {
        return res.status(400).json({ message: `VAT/Tax ID '${vatNumber.trim()}' is already registered to customer '${existingVat.name}'.` });
      }
    }

    const customer = await Customer.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      contact: (contact || '').trim(),
      phone: (phone || '').trim(),
      vatNumber: (vatNumber || '').trim(),
      country: country || 'Spain',
      billingAddress: billingAddress || {},
      shippingAddress: shippingAddress || {},
      paymentTerms: paymentTerms || 'Net 30',
      iban: (iban || '').trim(),
      bankInfo: (bankInfo || '').trim(),
      tier: tier || 'bronze',
      notes: notes || '',
      status: status || (active === false ? 'inactive' : 'active'),
      active: active !== undefined ? Boolean(active) : true,
      orders: 0,
      total_spend: 0,
      last_activity: new Date(),
      company: req.user.company
    });

    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// UPDATE Customer
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const customer = await Customer.findOne({ _id: req.params.id, company: req.user.company });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const { name, email, vatNumber, contact, phone, country, billingAddress, shippingAddress, paymentTerms, iban, bankInfo, tier, notes, active, status } = req.body;

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ message: 'Customer name cannot be empty.' });
      customer.name = name.trim();
    }

    if (email !== undefined) {
      if (!email.trim() || !isValidEmail(email.trim())) {
        return res.status(400).json({ message: `Invalid email address: '${email}'.` });
      }
      customer.email = email.trim().toLowerCase();
    }

    if (vatNumber !== undefined && vatNumber.trim() !== customer.vatNumber) {
      if (vatNumber.trim()) {
        const existingVat = await Customer.findOne({ company: req.user.company, vatNumber: vatNumber.trim(), _id: { $ne: customer._id } });
        if (existingVat) {
          return res.status(400).json({ message: `VAT/Tax ID '${vatNumber.trim()}' is already used by '${existingVat.name}'.` });
        }
      }
      customer.vatNumber = vatNumber.trim();
    }

    if (contact !== undefined) customer.contact = contact.trim();
    if (phone !== undefined) customer.phone = phone.trim();
    if (country !== undefined) customer.country = country;
    if (billingAddress !== undefined) customer.billingAddress = { ...customer.billingAddress?.toObject?.(), ...billingAddress };
    if (shippingAddress !== undefined) customer.shippingAddress = { ...customer.shippingAddress?.toObject?.(), ...shippingAddress };
    if (paymentTerms !== undefined) customer.paymentTerms = paymentTerms;
    if (iban !== undefined) customer.iban = iban.trim();
    if (bankInfo !== undefined) customer.bankInfo = bankInfo.trim();
    if (tier !== undefined) customer.tier = tier;
    if (notes !== undefined) customer.notes = notes;
    if (active !== undefined) {
      customer.active = Boolean(active);
      customer.status = customer.active ? 'active' : 'inactive';
    }
    if (status !== undefined) {
      customer.status = status;
      customer.active = status === 'active';
    }

    customer.last_activity = new Date();
    await customer.save();
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// DELETE Customer
router.delete('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Customer.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Customer not found' });
    res.json({ message: 'Customer deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;

