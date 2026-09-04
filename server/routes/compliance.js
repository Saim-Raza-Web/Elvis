import express from 'express';
import VeriFactuRecord from '../models/VeriFactuRecord.js';
import SIIRecord from '../models/SIIRecord.js';
import { protect } from '../middleware/auth.js';
import ComplianceConfig from '../models/ComplianceConfig.js';
import { aeatService } from '../services/aeat.service.js';

const router = express.Router();
router.use(protect);

// ── GET compliance config status ──────────────────────────────────────────────
router.get('/config', async (req, res, next) => {
  try {
    const config = await ComplianceConfig.findOne({ company: req.user.company });
    if (!config) {
      return res.json({ hasCertificate: false, verifactuEnabled: false, siiEnabled: false });
    }
    res.json({
      hasCertificate:    !!config.certificatePfxEncrypted,
      verifactuEnabled:  config.verifactuEnabled,
      siiEnabled:        config.siiEnabled,
      certificateExpiry: config.certificateExpiry,
      certificateSubject: config.certificateSubject,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST compliance config (upload certificate / toggle features) ──────────────
router.post('/config', async (req, res, next) => {
  try {
    const { pfxBase64, password, verifactuEnabled, siiEnabled } = req.body;

    let config = await ComplianceConfig.findOne({ company: req.user.company });
    if (!config) config = new ComplianceConfig({ company: req.user.company });

    if (verifactuEnabled !== undefined) config.verifactuEnabled = verifactuEnabled;
    if (siiEnabled       !== undefined) config.siiEnabled       = siiEnabled;

    if (pfxBase64 && password) {
      // Validate and store the certificate (parsePfx is called inside saveCertificate)
      const pfxBuffer = Buffer.from(pfxBase64, 'base64');
      await aeatService.saveCertificate(req.user.company, pfxBuffer, password);
    } else {
      await config.save();
    }

    res.json({ message: 'Configuration saved successfully' });
  } catch (err) {
    next(err);
  }
});

// ── GET all VeriFactu records ──────────────────────────────────────────────────
router.get('/verifactu', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = { company: req.user.company };
    if (status) filter.status = status;

    const records = await VeriFactuRecord.find(filter)
      .populate('invoiceId',     'invoiceNumber totalAmount')
      .populate('supplierBillId', 'billNumber grandTotal')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const total = await VeriFactuRecord.countDocuments(filter);
    res.json({ records, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// ── POST retry VeriFactu submission ────────────────────────────────────────────
// This now actually calls the AEAT SOAP endpoint.
router.post('/verifactu/:id/retry', async (req, res, next) => {
  try {
    const record = await VeriFactuRecord.findOne({ _id: req.params.id, company: req.user.company });
    if (!record) return res.status(404).json({ message: 'VeriFactu record not found' });

    if (record.status === 'ACCEPTED') {
      return res.status(400).json({ message: 'Record is already accepted by AEAT. Cannot retry.' });
    }

    if (record.status === 'SUBMITTING') {
      return res.status(409).json({ message: 'Record is currently being submitted. Please wait.' });
    }

    // Attempt real AEAT submission
    let updatedRecord;
    try {
      updatedRecord = await aeatService.submitVeriFactu(req.user.company, record._id);
    } catch (submitErr) {
      // submitVeriFactu already persists the error state — surface it to caller
      const freshRecord = await VeriFactuRecord.findById(record._id);
      return res.status(502).json({
        message:  `AEAT submission failed: ${submitErr.message}`,
        code:     submitErr.code || 'AEAT_ERROR',
        record:   freshRecord,
      });
    }

    res.json(updatedRecord);
  } catch (err) {
    next(err);
  }
});

// ── GET all SII records ────────────────────────────────────────────────────────
router.get('/sii', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = { company: req.user.company };
    if (status) filter.status = status;

    const records = await SIIRecord.find(filter)
      .populate('invoiceId',     'invoiceNumber totalAmount')
      .populate('supplierBillId', 'billNumber grandTotal')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const total = await SIIRecord.countDocuments(filter);
    res.json({ records, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// ── POST retry SII submission ──────────────────────────────────────────────────
// This now actually calls the AEAT SII SOAP endpoint.
router.post('/sii/:id/retry', async (req, res, next) => {
  try {
    const record = await SIIRecord.findOne({ _id: req.params.id, company: req.user.company });
    if (!record) return res.status(404).json({ message: 'SII record not found' });

    if (record.status === 'ACCEPTED') {
      return res.status(400).json({ message: 'Record is already accepted by AEAT. Cannot retry.' });
    }

    if (record.status === 'SUBMITTING') {
      return res.status(409).json({ message: 'Record is currently being submitted. Please wait.' });
    }

    let updatedRecord;
    try {
      updatedRecord = await aeatService.submitSiiRecord(req.user.company, record._id);
    } catch (submitErr) {
      const freshRecord = await SIIRecord.findById(record._id);
      return res.status(502).json({
        message: `SII submission failed: ${submitErr.message}`,
        code:    submitErr.code || 'SII_ERROR',
        record:  freshRecord,
      });
    }

    res.json(updatedRecord);
  } catch (err) {
    next(err);
  }
});

export default router;
