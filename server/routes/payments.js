import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { IdempotencyService } from '../services/IdempotencyService.js';
import { recordPaymentReceipt, recordPaymentAllocation } from '../services/paymentEngine.js';
import Payment from '../models/Payment.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('admin', 'manager'));

/**
 * POST /api/v1/payments/:id/allocate
 * Authoritative Customer Payment Allocation to an Invoice
 * Dr Customer Deposits (Account 438) / Cr Accounts Receivable (Account 430)
 */
router.post('/:id/allocate', async (req, res, next) => {
  const companyId = req.user.company;
  if (!companyId) {
    return res.status(403).json({ message: 'Company context required.' });
  }

  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    return res.status(400).json({ message: 'Missing x-idempotency-key header.' });
  }

  // 1. Idempotency Lock outside the financial transaction (deadlock-safe)
  let idempotencyLock;
  try {
    idempotencyLock = await IdempotencyService.acquireLock(
      companyId,
      `POST /api/v1/payments/${req.params.id}/allocate`,
      idempotencyKey.trim(),
      req.body
    );
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ message: err.message });
    }
    return next(err);
  }

  // 2. Replay cached response on identical previous completion
  if (idempotencyLock.status === 'CACHED') {
    return res.status(200).json(idempotencyLock.response);
  }

  // 3. Execute Financial Transaction
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await recordPaymentAllocation({
        companyId,
        paymentId: req.params.id,
        body: req.body,
        user: req.user,
        session
      });
    });

    const responsePayload = {
      message: `Allocation of €${result.journalEntry.totalDebit} to Invoice ${result.invoice.invoiceNumber} recorded successfully.`,
      allocationId: result.allocationId,
      payment: result.payment,
      invoice: result.invoice,
      journalEntry: result.journalEntry
    };

    // 4. Commit Idempotency Record
    await IdempotencyService.completeLock(idempotencyLock.record._id, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (err) {
    // 5. Fail Idempotency Record on error to release lease
    if (idempotencyLock?.record) {
      try {
        await IdempotencyService.failLock(idempotencyLock.record._id, err);
      } catch (failErr) {
        console.warn('Warning: Failed to update idempotency failure state:', failErr.message);
      }
    }

    const statusCode = err.status || (err.name === 'ValidationError' ? 400 : 400);
    return res.status(statusCode).json({ message: err.message });
  } finally {
    await session.endSession();
  }
});

/**
 * POST /api/v1/payments
 * Authoritative Customer Payment Receipt Creation
 * Dr PaymentAccount (Bank/Cash) / Cr Customer Deposits (Account 438)
 */
router.post('/', async (req, res, next) => {
  const companyId = req.user.company;
  if (!companyId) {
    return res.status(403).json({ message: 'Company context required.' });
  }

  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    return res.status(400).json({ message: 'Missing x-idempotency-key header.' });
  }

  // 1. Idempotency Lock outside the financial transaction (deadlock-safe)
  let idempotencyLock;
  try {
    idempotencyLock = await IdempotencyService.acquireLock(
      companyId,
      'POST /api/v1/payments',
      idempotencyKey.trim(),
      req.body
    );
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ message: err.message });
    }
    return next(err);
  }

  // 2. Replay cached response on identical previous completion
  if (idempotencyLock.status === 'CACHED') {
    return res.status(200).json(idempotencyLock.response);
  }

  // 3. Execute Financial Transaction
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await recordPaymentReceipt({
        companyId,
        body: req.body,
        user: req.user,
        session
      });
    });

    const responsePayload = {
      message: `Payment ${result.payment.paymentNumber} recorded successfully.`,
      payment: result.payment,
      journalEntry: result.journalEntry
    };

    // 4. Commit Idempotency Record
    await IdempotencyService.completeLock(idempotencyLock.record._id, responsePayload);

    return res.status(201).json(responsePayload);
  } catch (err) {
    // 5. Fail Idempotency Record on error to release lease
    if (idempotencyLock?.record) {
      try {
        await IdempotencyService.failLock(idempotencyLock.record._id, err);
      } catch (failErr) {
        console.warn('Warning: Failed to update idempotency failure state:', failErr.message);
      }
    }

    const statusCode = err.status || (err.name === 'ValidationError' ? 400 : 400);
    return res.status(statusCode).json({ message: err.message });
  } finally {
    await session.endSession();
  }
});

/**
 * GET /api/v1/payments
 * Query customer payments for the authenticated tenant company
 */
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.user.company;
    const query = { company: companyId };

    if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) {
      query.customerId = req.query.customerId;
    }
    if (req.query.status) {
      query.status = req.query.status;
    }

    const payments = await Payment.find(query)
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(Number(req.query.limit) || 50);

    res.json(payments);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/payments/:id
 * Retrieve a specific payment by ID or paymentNumber
 */
router.get('/:id', async (req, res, next) => {
  try {
    const companyId = req.user.company;
    const payment = await Payment.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { paymentNumber: req.params.id }
      ],
      company: companyId
    });

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found.' });
    }

    res.json(payment);
  } catch (err) {
    next(err);
  }
});

export default router;
