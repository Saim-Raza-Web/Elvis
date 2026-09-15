import express from 'express';
import { parseGS1Barcode } from '../utils/gs1Parser.js';

const router = express.Router();

// POST /api/v1/sscc/decode — Decode GS1 barcode / SSCC-18
router.post('/decode', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) {
      return res.status(403).json({ message: 'Company context required' });
    }

    const rawBarcode = req.body?.barcode !== undefined ? req.body.barcode : req.body?.sscc;
    if (rawBarcode === undefined || rawBarcode === null) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_GS1_BARCODE', message: 'Barcode string is required in request body' }
      });
    }

    if (typeof rawBarcode !== 'string' || !rawBarcode.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_GS1_BARCODE', message: 'Barcode must be a non-empty string' }
      });
    }

    let barcodeToParse = rawBarcode.trim();
    if (/^\d{18}$/.test(barcodeToParse)) {
      barcodeToParse = '00' + barcodeToParse;
    }

    const result = parseGS1Barcode(barcodeToParse);
    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
