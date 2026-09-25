import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole, requireOfficeAccess } from '../middleware/auth.js';
import RateCard from '../models/RateCard.js';
import Client from '../models/Client.js';
import { threePlBillingEngine } from '../services/3plBillingEngine.js';

const router = express.Router();
router.use(protect);

const requireBillingAccess = requireRole('admin', 'manager', 'management', 'office', 'client_3pl');

// ── GET /api/v1/billing/rate-cards — List 3PL Rate Cards ──
router.get('/rate-cards', requireBillingAccess, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const query = { company: req.user.company };

    // If role is client_3pl, strictly restrict to own rate card
    if (req.user.role === 'client_3pl') {
      const clientName = req.user.owner || req.user.name;
      query.client = clientName;
    } else if (req.query.client) {
      query.client = String(req.query.client).trim();
    }

    if (req.query.warehouse) {
      query.warehouse = String(req.query.warehouse).trim();
    }

    const rateCards = await RateCard.find(query).sort({ client: 1, warehouse: 1 });
    res.json(rateCards);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/billing/rate-cards/:id — Single Rate Card ──
router.get('/rate-cards/:id', requireBillingAccess, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const query = { _id: req.params.id, company: req.user.company };
    if (req.user.role === 'client_3pl') {
      query.client = req.user.owner || req.user.name;
    }

    const item = await RateCard.findOne(query);
    if (!item) return res.status(404).json({ message: 'Rate card not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/billing/rate-cards — Create/Upsert Rate Card ──
router.post('/rate-cards', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const { name, client, warehouse = 'MIA', modality = 'RECURRENT', monthlyMinimum = 350.00, rates } = req.body;

    if (!name || !client) {
      return res.status(400).json({ message: 'name and client are required' });
    }

    // Lookup client doc if available
    const clientDoc = await Client.findOne({ company: req.user.company, name: client });

    const rateCard = await RateCard.create({
      name,
      client,
      clientId: clientDoc?._id,
      warehouse,
      company: req.user.company,
      modality,
      monthlyMinimum: Number(monthlyMinimum) || 0,
      rates: rates || undefined,
      isActive: true
    });

    res.status(201).json(rateCard);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/billing/rate-cards/:id — Update Rate Card ──
router.put('/rate-cards/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const rateCard = await RateCard.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      req.body,
      { new: true }
    );

    if (!rateCard) return res.status(404).json({ message: 'Rate card not found' });
    res.json(rateCard);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/billing/rate-cards/:id — Remove Rate Card ──
router.delete('/rate-cards/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const rateCard = await RateCard.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!rateCard) return res.status(404).json({ message: 'Rate card not found' });
    res.json({ message: 'Rate card deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/billing/3pl/calculate — Calculate Monthly 3PL Billing Breakdown ──
router.post(['/calculate', '/3pl/calculate'], requireBillingAccess, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    let clientName = req.body.client;

    // Enforce own client for client_3pl role
    if (req.user.role === 'client_3pl') {
      clientName = req.user.owner || req.user.name;
    }

    if (!clientName) {
      return res.status(400).json({ message: 'client name is required' });
    }

    const { warehouse, year, month, evaluationDate, forcedActiveDays } = req.body;

    const result = await threePlBillingEngine.calculateMonthlyBilling({
      companyId: req.user.company,
      clientName,
      warehouse: warehouse || 'MIA',
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
      evaluationDate: evaluationDate ? new Date(evaluationDate) : undefined,
      forcedActiveDays: forcedActiveDays !== undefined ? Number(forcedActiveDays) : null
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /summary — All Clients Summary ──
router.get(['/summary', '/3pl/summary'], requireRole('admin', 'manager', 'management', 'office'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const clients = await Client.find({ company: req.user.company, active: true }).sort({ name: 1 });
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const summaries = await Promise.all(
      clients.map(async (c) => {
        try {
          return await threePlBillingEngine.calculateMonthlyBilling({
            companyId: req.user.company,
            clientName: c.name,
            year: currentYear,
            month: currentMonth
          });
        } catch (_) {
          return null;
        }
      })
    );

    res.json({
      success: true,
      period: `${currentMonth}/${currentYear}`,
      clientsCount: clients.length,
      summaries: summaries.filter(Boolean)
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /evaluate-20-day-rule — Evaluate 20-Day Storage Rule ──
router.post(['/evaluate-20-day-rule', '/3pl/evaluate-20-day-rule'], requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const result = await threePlBillingEngine.evaluate20DayRule(req.user.company);
    res.json({
      success: true,
      message: '20-Day Storage Rule evaluated successfully',
      result
    });
  } catch (err) {
    next(err);
  }
});

// ── ALL /export-pdf — Export Monthly Billing PDF ──
router.all(['/export-pdf', '/export/pdf', '/3pl/export-pdf', '/3pl/export/pdf'], requireBillingAccess, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    let clientName = req.query.client || req.body?.client;
    if (req.user.role === 'client_3pl') {
      clientName = req.user.owner || req.user.name;
    }

    if (!clientName) return res.status(400).json({ message: 'client parameter required' });

    const year = req.query.year || req.body?.year;
    const month = req.query.month || req.body?.month;
    const warehouse = req.query.warehouse || req.body?.warehouse || 'MIA';

    const calcResult = await threePlBillingEngine.calculateMonthlyBilling({
      companyId: req.user.company,
      clientName,
      warehouse,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined
    });

    const pdfBuffer = await threePlBillingEngine.generateBillingPDF(calcResult);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="billing-3pl-${clientName}-${calcResult.period?.month || month}-${calcResult.period?.year || year}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// ── ALL /export-csv — Export Monthly Billing CSV ──
router.all(['/export-csv', '/export/csv', '/3pl/export-csv', '/3pl/export/csv'], requireBillingAccess, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    let clientName = req.query.client || req.body?.client;
    if (req.user.role === 'client_3pl') {
      clientName = req.user.owner || req.user.name;
    }

    if (!clientName) return res.status(400).json({ message: 'client parameter required' });

    const year = req.query.year || req.body?.year;
    const month = req.query.month || req.body?.month;
    const warehouse = req.query.warehouse || req.body?.warehouse || 'MIA';

    const calc = await threePlBillingEngine.calculateMonthlyBilling({
      companyId: req.user.company,
      clientName,
      warehouse,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined
    });

    const csvContent = await threePlBillingEngine.generateSettlementCsv(calc);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="billing-3pl-${clientName}-${calc.period?.month || month}-${calc.period?.year || year}.csv"`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
});

export default router;
