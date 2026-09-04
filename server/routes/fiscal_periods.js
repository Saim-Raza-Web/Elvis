import express from 'express';
import mongoose from 'mongoose';
import FiscalPeriod from '../models/FiscalPeriod.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';
import { requireModuleAccess, protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, requireModuleAccess('billing'), async (req, res) => {
  try {
    const periods = await FiscalPeriod.find({ company: req.user.company }).sort({ startDate: -1 });
    res.json(periods);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', protect, requireModuleAccess('billing'), async (req, res) => {
  const { fiscalYear, period, name, startDate, endDate } = req.body;

  if (!fiscalYear || !period || !name || !startDate || !endDate) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const sDate = new Date(startDate);
  const eDate = new Date(endDate);

  if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
    return res.status(400).json({ message: 'Invalid date formats' });
  }

  if (sDate >= eDate) {
    return res.status(400).json({ message: 'startDate must be before endDate' });
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const config = await CompanyAccountingConfig.findOneAndUpdate(
      { company: req.user.company },
      { $set: { _fiscalPeriodConcurrencyLock: Date.now() } },
      { session, new: true }
    );

    if (!config) {
      throw new Error('Company Accounting Config not found. Cannot create period.');
    }

    const existingPeriodNumber = await FiscalPeriod.findOne({
      company: req.user.company,
      fiscalYear: Number(fiscalYear),
      period: Number(period)
    }).session(session);

    if (existingPeriodNumber) {
      throw new Error(`Fiscal period ${period} for year ${fiscalYear} already exists.`);
    }

    const overlappingPeriod = await FiscalPeriod.findOne({
      company: req.user.company,
      startDate: { $lt: eDate },
      endDate: { $gt: sDate }
    }).session(session);

    if (overlappingPeriod) {
      throw new Error(`Period dates overlap with existing period: ${overlappingPeriod.name}`);
    }

    const newPeriod = await FiscalPeriod.create([{
      company: req.user.company,
      fiscalYear: Number(fiscalYear),
      period: Number(period),
      name: String(name),
      startDate: sDate,
      endDate: eDate,
      status: 'OPEN',
      createdBy: req.user.name || req.user.email || 'Admin'
    }], { session });

    await session.commitTransaction();
    res.status(201).json(newPeriod[0]);
  } catch (error) {
    await session.abortTransaction();
    if (error.code === 11000) {
      res.status(400).json({ message: 'Duplicate fiscal period.' });
    } else {
      res.status(400).json({ message: error.message });
    }
  } finally {
    session.endSession();
  }
});

router.put('/:id/close', protect, requireModuleAccess('billing'), async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const period = await FiscalPeriod.findOne({
      _id: req.params.id,
      company: req.user.company
    }).session(session);

    if (!period) {
      throw new Error('Fiscal period not found');
    }

    if (period.status === 'CLOSED') {
      throw new Error(`Fiscal period ${period.name} is already closed.`);
    }

    period.status = 'CLOSED';
    period.closedAt = new Date();
    period.closedBy = req.user.name || req.user.email || 'Admin';

    await period.save({ session });

    await session.commitTransaction();
    res.json(period);
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

export default router;
