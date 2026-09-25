import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import EdiInterchange from '../models/EdiInterchange.js';
import { EdiManager } from '../services/edi/EdiManager.js';
import { defaultSftpAdapter } from '../services/edi/SftpAdapter.js';

const router = express.Router();
router.use(protect);

// ── GET /api/v1/edi/status — SFTP & EDI Boundary Status ──
router.get('/status', requireRole('admin', 'manager', 'management', 'office'), (req, res) => {
  const sftpStatus = defaultSftpAdapter.getStatus();
  res.json({
    edi: {
      standardsSupported: ['EDIFACT D96A ORDERS', 'ANSI X12 850', 'EDIFACT D96A DESADV'],
      desadvGenerator: 'READY',
      quarantineEngine: 'READY'
    },
    sftp: sftpStatus
  });
});

// ── POST /api/v1/edi/ingest — Ingest raw EDI payload (EDIFACT or X12) ──
router.post('/ingest', requireRole('admin', 'manager', 'client_3pl'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const { rawPayload, standardHint, clientName } = req.body;
    if (!rawPayload) {
      return res.status(400).json({ message: 'rawPayload is required' });
    }

    // If role is client_3pl, enforce their own client identity
    const effectiveClient = req.user.role === 'client_3pl'
      ? (req.user.owner || req.user.name)
      : clientName;

    const result = await EdiManager.ingestMessage({
      rawPayload,
      companyId: req.user.company,
      clientName: effectiveClient,
      standardHint
    });

    const statusCode = result.status === 'PROCESSED' || result.status === 'ALREADY_PROCESSED'
      ? 200
      : (result.status === 'ERROR' || result.status === 'QUARANTINED' ? 422 : 202);
    res.status(statusCode).json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/edi/interchanges — List EDI audit log / quarantine ──
router.get('/interchanges', requireRole('admin', 'manager', 'management', 'office'), async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const query = { company: req.user.company };

    if (req.query.status) {
      query.status = String(req.query.status).toUpperCase();
    }
    if (req.query.direction) {
      query.direction = String(req.query.direction).toUpperCase();
    }
    if (req.query.standard) {
      query.standard = String(req.query.standard).toUpperCase();
    }
    if (req.query.documentType) {
      query.documentType = String(req.query.documentType).toUpperCase();
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      EdiInterchange.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('targetOrderId', 'orderId customer total status')
        .populate('targetShipmentId', 'tracking_number carrier status'),
      EdiInterchange.countDocuments(query)
    ]);

    res.json({
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/edi/interchanges/:id — Single Interchange ──
router.get('/interchanges/:id', requireRole('admin', 'manager', 'management', 'office'), async (req, res, next) => {
  try {
    const item = await EdiInterchange.findOne({ _id: req.params.id, company: req.user.company })
      .populate('targetOrderId')
      .populate('targetShipmentId');
    if (!item) return res.status(404).json({ message: 'EDI interchange not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/edi/interchanges/:id/retry — Retry Quarantined Interchange ──
router.post('/interchanges/:id/retry', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const item = await EdiInterchange.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'EDI interchange not found' });

    const result = await EdiManager.retryInterchange(item._id);
    res.json({
      message: 'Retry evaluated',
      result
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/edi/generate-desadv — Outbound Despatch Advice ──
router.post('/generate-desadv', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { shipmentId, ssccList } = req.body;
    if (!shipmentId) {
      return res.status(400).json({ message: 'shipmentId is required' });
    }

    const result = await EdiManager.generateDesadv({
      shipmentId,
      companyId: req.user.company,
      ssccList: Array.isArray(ssccList) ? ssccList : []
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
