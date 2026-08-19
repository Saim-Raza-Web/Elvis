import express from 'express';
import mongoose from 'mongoose';
import Client from '../models/Client.js';
import InventoryBalance from '../models/InventoryBalance.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

const DEFAULT_OWNERS = [
  { name: 'Apple Distribution 3PL', vat: 'US-998877665', country: 'United States', contact: 'John Distribution', email: 'apple@3pl.com', phone: '+1 305 555 0199', warehouseAccess: ['MIA', 'LAX'] },
  { name: 'Acme Logistics 3PL', vat: 'US-112233445', country: 'United States', contact: 'Acme Logistics Team', email: 'contact@acmelogistics.com', phone: '+1 305 555 0188', warehouseAccess: ['MIA'] },
  { name: 'Global Retail Corp', vat: 'US-554433221', country: 'United States', contact: 'Global Retail Operations', email: 'ops@globalretail.com', phone: '+1 305 555 0177', warehouseAccess: ['MIA', 'ORD'] },
  { name: 'Client Alpha', vat: 'A-87654321', country: 'Spain', contact: 'Client Alpha Support', email: 'alpha@client.es', phone: '+34 912 345 678', warehouseAccess: ['MIA'] },
  { name: 'Internal Stock', vat: 'N/A', country: 'Spain', contact: 'Internal Warehouse Operations', email: 'internal@demologistics.io', phone: '+34 900 000 000', warehouseAccess: ['MIA'] }
];

// GET all clients/owners for company
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    let clients = await Client.find({ company: req.user.company }).sort({ name: 1 });

    // Seed defaults if empty
    if (clients.length === 0) {
      const seedData = DEFAULT_OWNERS.map(o => ({
        ...o,
        company: req.user.company,
        createdAt: new Date(),
        updatedAt: new Date()
      }));
      try {
        await Client.insertMany(seedData, { ordered: false });
        clients = await Client.find({ company: req.user.company }).sort({ name: 1 });
      } catch (_) {
        clients = await Client.find({ company: req.user.company }).sort({ name: 1 });
      }
    }

    res.json(clients);
  } catch (err) {
    next(err);
  }
});

// POST create client/owner
router.post('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { name, vat, country, contact, email, phone, notes, active, warehouseAccess } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Client/Owner name is required' });

    const existingName = await Client.findOne({ company: req.user.company, name: name.trim() });
    if (existingName) {
      return res.status(400).json({ message: `Client/Owner name '${name.trim()}' already exists.` });
    }

    if (vat && vat.trim()) {
      const existingVat = await Client.findOne({ company: req.user.company, vat: vat.trim() });
      if (existingVat) {
        return res.status(400).json({ message: `VAT/Tax ID '${vat.trim()}' is already registered to client '${existingVat.name}'.` });
      }
    }

    const client = await Client.create({
      name: name.trim(),
      vat: vat ? vat.trim() : '',
      country: country || 'Spain',
      contact: contact || '',
      email: email || '',
      phone: phone || '',
      notes: notes || '',
      active: active !== undefined ? Boolean(active) : true,
      warehouseAccess: Array.isArray(warehouseAccess) && warehouseAccess.length > 0 ? warehouseAccess : ['MIA'],
      company: req.user.company
    });

    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
});

// PUT update client/owner
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const client = await Client.findOne({ _id: req.params.id, company: req.user.company });
    if (!client) return res.status(404).json({ message: 'Client/Owner not found' });

    const { name, vat, country, contact, email, phone, notes, active, warehouseAccess } = req.body;
    if (name && name.trim() !== client.name) {
      const existingName = await Client.findOne({ company: req.user.company, name: name.trim(), _id: { $ne: client._id } });
      if (existingName) return res.status(400).json({ message: `Client name '${name.trim()}' already exists.` });
      client.name = name.trim();
    }

    if (vat !== undefined && vat.trim() !== client.vat) {
      if (vat.trim()) {
        const existingVat = await Client.findOne({ company: req.user.company, vat: vat.trim(), _id: { $ne: client._id } });
        if (existingVat) return res.status(400).json({ message: `VAT/Tax ID '${vat.trim()}' is already used by '${existingVat.name}'.` });
      }
      client.vat = vat.trim();
    }

    if (country !== undefined) client.country = country;
    if (contact !== undefined) client.contact = contact;
    if (email !== undefined) client.email = email;
    if (phone !== undefined) client.phone = phone;
    if (notes !== undefined) client.notes = notes;
    if (active !== undefined) client.active = Boolean(active);
    if (warehouseAccess !== undefined) client.warehouseAccess = warehouseAccess;

    await client.save();
    res.json(client);
  } catch (err) {
    next(err);
  }
});

// DELETE client/owner
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const client = await Client.findOne({ _id: req.params.id, company: req.user.company });
    if (!client) return res.status(404).json({ message: 'Client/Owner not found' });

    // Check if stock exists for this 3PL owner
    const stockCount = await InventoryBalance.countDocuments({
      company: req.user.company,
      owner: client.name,
      $or: [{ qtyAvailable: { $gt: 0 } }, { qtyQuarantine: { $gt: 0 } }, { qtyAwaitingPutaway: { $gt: 0 } }]
    });

    if (stockCount > 0) {
      return res.status(400).json({
        message: `Cannot delete 3PL Client '${client.name}' because ${stockCount} inventory stock record(s) are currently associated with it. Please deactivate the client instead.`
      });
    }

    await Client.findByIdAndDelete(client._id);
    res.json({ message: `Client/Owner '${client.name}' deleted successfully` });
  } catch (err) {
    next(err);
  }
});

export default router;
