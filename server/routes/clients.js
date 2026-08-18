import express from 'express';
import mongoose from 'mongoose';
import Client from '../models/Client.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

const DEFAULT_OWNERS = [
  { name: 'Apple Distribution 3PL', vat: 'US-998877665', contact: 'John Distribution', warehouseAccess: ['MIA', 'LAX'] },
  { name: 'Acme Logistics 3PL', vat: 'US-112233445', contact: 'Acme Logistics Team', warehouseAccess: ['MIA'] },
  { name: 'Global Retail Corp', vat: 'US-554433221', contact: 'Global Retail Operations', warehouseAccess: ['MIA', 'ORD'] },
  { name: 'Internal Stock', vat: 'N/A', contact: 'Internal Warehouse Operations', warehouseAccess: ['MIA'] },
  { name: 'Default Owner', vat: 'N/A', contact: 'Default Operations', warehouseAccess: ['MIA'] }
];

// GET all clients/owners for company
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const db = mongoose.connection?.db;
    let clients = db 
      ? await db.collection('clients').find({ company: req.user.company }).sort({ name: 1 }).toArray()
      : await Client.find({ company: req.user.company }).sort({ name: 1 });

    // Seed defaults if empty
    if (clients.length === 0) {
      const seedData = DEFAULT_OWNERS.map(o => ({
        ...o,
        company: req.user.company,
        createdAt: new Date(),
        updatedAt: new Date()
      }));
      try {
        if (db) {
          await db.collection('clients').insertMany(seedData, { ordered: false });
          clients = await db.collection('clients').find({ company: req.user.company }).sort({ name: 1 }).toArray();
        } else {
          await Client.insertMany(seedData, { ordered: false });
          clients = await Client.find({ company: req.user.company }).sort({ name: 1 });
        }
      } catch (_) {
        clients = db 
          ? await db.collection('clients').find({ company: req.user.company }).sort({ name: 1 }).toArray()
          : await Client.find({ company: req.user.company }).sort({ name: 1 });
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

    const { name, vat, contact, email, phone, warehouseAccess } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Client/Owner name is required' });

    const existing = await Client.findOne({ company: req.user.company, name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: `Client/Owner '${name.trim()}' already exists.` });
    }

    const client = await Client.create({
      name: name.trim(),
      vat: vat || '',
      contact: contact || '',
      email: email || '',
      phone: phone || '',
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

    const { name, vat, contact, email, phone, warehouseAccess } = req.body;
    if (name) client.name = name.trim();
    if (vat !== undefined) client.vat = vat;
    if (contact !== undefined) client.contact = contact;
    if (email !== undefined) client.email = email;
    if (phone !== undefined) client.phone = phone;
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

    const client = await Client.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!client) return res.status(404).json({ message: 'Client/Owner not found' });

    res.json({ message: `Client/Owner '${client.name}' deleted successfully` });
  } catch (err) {
    next(err);
  }
});

export default router;
