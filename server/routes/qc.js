import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import QuarantineInventory from '../models/QuarantineInventory.js';
import QCInspection from '../models/QCInspection.js';
import PutawayTask from '../models/PutawayTask.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import Counter from '../models/Counter.js';
import Notification from '../models/Notification.js';
import ActivityLog from '../models/ActivityLog.js';
import Product from '../models/Product.js';
import ASN from '../models/ASN.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { putawayEngine } from '../services/putawayEngine.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');

/** Atomic Sequential QC Number: QC-000001, QC-000002... */
async function nextQcNumber(company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: 'qc', company },
    { $inc: { seq: 1 } },
    opts
  );
  return `QC-${String(counter.seq).padStart(6, '0')}`;
}

/** Atomic Sequential Putaway Number: PUT-000001, PUT-000002... */
async function nextPutawayNumber(company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: 'putaway', company },
    { $inc: { seq: 1 } },
    opts
  );
  return `PUT-${String(counter.seq).padStart(6, '0')}`;
}

/** Atomic Sequential RTV Number: RTV-000001, RTV-000002... */
async function nextRtvNumber(company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: 'rtv', company },
    { $inc: { seq: 1 } },
    opts
  );
  return `RTV-${String(counter.seq).padStart(6, '0')}`;
}

/** Helper activity logger */
async function logActivity(req, action, module, detail, session) {
  try {
    const opts = session ? { session } : {};
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: req.user?.email || req.user?.name || 'system',
      role: req.user?.role || 'unknown',
      action,
      module,
      detail,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
      timestamp: new Date(),
      company: req.user?.company,
    }], opts);
  } catch (_) {}
}

/** QC State Machine Transition Lock */
function isValidQcStateTransition(currentStatus, targetStatus) {
  if (currentStatus === targetStatus) return true;
  const TRANSITIONS = {
    pending_qc: ['under_inspection', 'qc_passed', 'awaiting_putaway', 'qc_failed', 'returned_to_vendor'],
    under_inspection: ['qc_passed', 'awaiting_putaway', 'qc_failed', 'returned_to_vendor'],
    qc_passed: [], // Terminal state
    awaiting_putaway: [], // Terminal state
    qc_failed: ['returned_to_vendor'], // Can only transition to RTV from QC failure
    returned_to_vendor: [] // Terminal state
  };
  const allowed = TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

// ── GET /api/v1/qc — List Quarantine Items & Inspections ──
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const query = { company: req.user.company };

    if (req.query.search) {
      const s = String(req.query.search).trim();
      const regex = new RegExp(s, 'i');
      query.$or = [
        { quarantineId: regex },
        { inspectionId: regex },
        { asnId: regex },
        { asnNumber: regex },
        { sku: regex },
        { productName: regex },
        { lotNumber: regex },
        { batchNumber: regex }
      ];
    }

    if (req.query.status && req.query.status !== 'All') {
      query.status = req.query.status;
    }

    if (req.context && req.context.warehouses) {
      query.warehouse = { $in: req.context.warehouses.map(w => w.code) };
    }

    const result = await paginateQuery(QuarantineInventory, query, req);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/v1/qc/:id — Details ──
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const item = await QuarantineInventory.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Quarantine item not found' });

    const inspection = await QCInspection.findOne({ quarantineId: item.quarantineId, company: req.user.company });

    res.json({ quarantineItem: item, inspection });
  } catch (err) { next(err); }
});

// ── POST /api/v1/qc — Start Inspection (pending_qc -> under_inspection) ──
router.post('/', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const { quarantineId } = req.body;
    const qItem = await QuarantineInventory.findOne({ quarantineId, company: req.user.company }).session(session);

    if (!qItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Quarantine record not found' });
    }

    // State Machine Lock
    if (!isValidQcStateTransition(qItem.status, 'under_inspection')) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Invalid status transition from '${qItem.status}' to 'under_inspection'.` });
    }

    const qcId = await nextQcNumber(req.user.company, session);
    const inspector = req.user.email || req.user.name || 'system';

    qItem.status = 'under_inspection';
    qItem.inspectionId = qcId;
    await qItem.save({ session });

    const inspection = await QCInspection.create([{
      inspectionId: qcId,
      quarantineId: qItem.quarantineId,
      asnId: qItem.asnId,
      asnNumber: qItem.asnNumber,
      sku: qItem.sku,
      productName: qItem.productName,
      warehouse: qItem.warehouse,
      qty: qItem.qty,
      lotNumber: qItem.lotNumber,
      batchNumber: qItem.batchNumber,
      expiryDate: qItem.expiryDate,
      inspector,
      inspectionDate: new Date(),
      status: 'under_inspection',
      company: req.user.company
    }], { session });

    await logActivity(req, 'QC_STARTED', 'QC', `Started inspection ${qcId} for SKU ${qItem.sku} (${qItem.qty} units)`, session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ quarantineItem: qItem, inspection: inspection[0] });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── PUT /api/v1/qc/:id — Update Inspection Form ──
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const inspection = await QCInspection.findOne({ _id: req.params.id, company: req.user.company });
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    // Block updating completed inspections
    if (inspection.status === 'qc_passed' || inspection.status === 'qc_failed' || inspection.status === 'returned_to_vendor') {
      return res.status(400).json({ message: `Cannot modify inspection in terminal state '${inspection.status}'.` });
    }

    Object.assign(inspection, req.body);
    const updated = await inspection.save();

    await logActivity(req, 'INSPECTION_UPDATED', 'QC', `Updated inspection details for ${updated.inspectionId}`);

    res.json(updated);
  } catch (err) { next(err); }
});

// ── POST /api/v1/qc/:id/pass — PASS QC & TRANSITION TO AWAITING_PUTAWAY (PUTAWAY TASK GENERATED ONLY ON QC PASS) ──
router.post('/:id/pass', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const qItem = await QuarantineInventory.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!qItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Quarantine record not found' });
    }

    // State Machine Lock: Prevent backward transitions or repeat passes
    if (qItem.status === 'qc_passed' || qItem.status === 'awaiting_putaway' || qItem.status === 'returned_to_vendor') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Item has already been processed with terminal status '${qItem.status}'. Repeat operations blocked.` });
    }

    if (!isValidQcStateTransition(qItem.status, 'awaiting_putaway')) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Invalid state transition from '${qItem.status}' to 'awaiting_putaway'.` });
    }

    // Check Duplicate Putaway Task Prevention
    const existingTask = await PutawayTask.findOne({
      qcId: qItem.inspectionId || qItem.quarantineId,
      company: req.user.company
    }).session(session);

    if (existingTask) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Putaway Task ${existingTask.taskId} already exists for this inspection. Duplicate task creation blocked.` });
    }

    const operator = req.user.email || req.user.name || 'system';
    const warehouse = qItem.warehouse || 'MIA';
    const totalQty = qItem.qty;

    const {
      approvedQty: rawApproved,
      rejectionDestination,
      arrivalTemp,
      minTemp,
      maxTemp,
      humidityPct,
      dataLogger,
      tempRangeMin = 2,
      tempRangeMax = 8,
      overrideBlocked,
      notes,
      attachments
    } = req.body;

    // Check Cold Chain temperature bounds
    const prodDoc = await Product.findOne({ sku: qItem.sku, company: req.user.company }).session(session);
    const isColdChain = Boolean(prodDoc && (prodDoc.category === 'COLD' || prodDoc.qc_profile === 'Cold Chain'));

    if (isColdChain && arrivalTemp !== undefined && arrivalTemp !== null && arrivalTemp !== '') {
      const tempNum = Number(arrivalTemp);
      const minBound = Number(tempRangeMin);
      const maxBound = Number(tempRangeMax);

      if (tempNum < minBound || tempNum > maxBound) {
        if (!overrideBlocked && req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.role !== 'qc_supervisor') {
          await session.abortTransaction();
          session.endSession();
          return res.status(422).json({
            message: `BLOCKED: Arrival temperature (${tempNum}°C) is outside configured Cold Chain range (${minBound}°C - ${maxBound}°C). Supervisor override required to approve.`
          });
        }
      }
    }

    // Partial approval calculation
    const approvedQty = rawApproved !== undefined ? Math.min(totalQty, Math.max(0, Number(rawApproved))) : totalQty;
    const rejectedQty = totalQty - approvedQty;

    if (approvedQty <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Approved quantity must be greater than 0. If rejecting all units, use Fail QC / RTV.' });
    }

    // 1. Pipeline Refinement: Move approvedQty from qtyQuarantine -> qtyAwaitingPutaway
    await InventoryBalance.findOneAndUpdate(
      { company: req.user.company, warehouse, sku: qItem.sku, owner: qItem.owner, ownerType: qItem.ownerType, lotNumber: qItem.lotNumber || 'DEFAULT-LOT', bin: qItem.bin || `${warehouse}-RCV-DOCK1` },
      { $inc: { qtyQuarantine: -totalQty, qtyAwaitingPutaway: approvedQty } },
      { upsert: true, new: true, session }
    );

    // 2. Create QC_RELEASE Inventory Transaction for approved stock
    await InventoryTransaction.create([{
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      type: 'QC_RELEASE',
      sku: qItem.sku,
      warehouse,
      qty: approvedQty,
      lotNumber: qItem.lotNumber,
      batchNumber: qItem.batchNumber,
      expiryDate: qItem.expiryDate,
      asnNumber: qItem.asnNumber || qItem.asnId,
      referenceId: qItem.inspectionId || qItem.quarantineId,
      user: operator,
      notes: rejectedQty > 0 ? `Partial QC Pass: ${approvedQty} approved, ${rejectedQty} rejected (${rejectionDestination || 'Quarantine'})` : 'QC Released',
      company: req.user.company
    }], { session });

    // Handle partial rejection transaction if applicable
    if (rejectedQty > 0) {
      await InventoryTransaction.create([{
        transactionId: 'TXN-REJ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
        type: 'QC_FAIL',
        sku: qItem.sku,
        warehouse,
        qty: rejectedQty,
        lotNumber: qItem.lotNumber,
        batchNumber: qItem.batchNumber,
        asnNumber: qItem.asnNumber || qItem.asnId,
        referenceId: qItem.inspectionId || qItem.quarantineId,
        user: operator,
        notes: `Partial QC Rejection: ${rejectedQty} units routed to ${rejectionDestination || 'Quarantine'}`,
        company: req.user.company
      }], { session });
    }

    // 3. Update QuarantineInventory Status -> awaiting_putaway
    qItem.status = 'awaiting_putaway';
    qItem.qty = approvedQty;
    await qItem.save({ session });

    if (qItem.inspectionId) {
      await QCInspection.findOneAndUpdate(
        { inspectionId: qItem.inspectionId, company: req.user.company },
        { 
          status: 'qc_passed',
          notes: notes || `Inspection Passed (${approvedQty} approved, ${rejectedQty} rejected)`,
          arrivalTemp: arrivalTemp !== undefined ? Number(arrivalTemp) : undefined,
          minTemp: minTemp !== undefined ? Number(minTemp) : undefined,
          maxTemp: maxTemp !== undefined ? Number(maxTemp) : undefined,
          humidityPct: humidityPct !== undefined ? Number(humidityPct) : undefined,
          dataLogger: dataLogger || '',
          tempRangeMin: Number(tempRangeMin),
          tempRangeMax: Number(tempRangeMax),
          approvedQty,
          rejectedQty,
          rejectionDestination: rejectionDestination || '',
          attachments: Array.isArray(attachments) ? attachments : []
        },
        { session }
      );
    }

    // 4. DYNAMIC LOCATION PROPOSAL & AUTOMATIC PUTAWAY TASK GENERATION (PUT-000001) FOR APPROVED STOCK ONLY
    const proposed = await putawayEngine.evaluatePutawayLocation({
      companyId: req.user.company,
      warehouse: qItem.warehouse,
      sku: qItem.sku,
      qty: approvedQty,
      lotNumber: qItem.lotNumber
    });

    const fromBinCode = qItem.bin || `${warehouse}-RCV-DOCK1`;
    const toBinCode = proposed.proposedBin;

    const targetAsnKey = qItem.asnId || qItem.asnNumber;
    const isObjId = targetAsnKey && mongoose.Types.ObjectId.isValid(targetAsnKey);
    const asnDoc = await ASN.findOne({
      $or: [
        ...(isObjId ? [{ _id: targetAsnKey }] : []),
        { asnId: targetAsnKey },
        { asnNumber: targetAsnKey }
      ],
      company: req.user.company
    }).session(session);
    const itemOwner = asnDoc?.owner || qItem.owner || 'Default Owner';
    const itemSupplier = asnDoc?.supplier || '';

    const putawayId = await nextPutawayNumber(req.user.company, session);
    const putawayTask = await PutawayTask.create([{
      taskId: putawayId,
      qcId: qItem.inspectionId || qItem.quarantineId,
      asnId: qItem.asnId,
      asnNumber: qItem.asnNumber,
      supplier: itemSupplier,
      owner: itemOwner,
      ownerType: qItem.ownerType || 'UNKNOWN',
      sku: qItem.sku,
      productName: qItem.productName,
      warehouse,
      qty: approvedQty,
      lotNumber: qItem.lotNumber,
      batchNumber: qItem.batchNumber,
      fromLocation: fromBinCode,
      toLocation: toBinCode,
      destinationBin: toBinCode,
      priority: 'normal',
      status: 'pending',
      createdBy: operator,
      company: req.user.company
    }], { session });

    // Transaction for Putaway Creation
    await InventoryTransaction.create([{
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      type: 'PUTAWAY_CREATED',
      sku: qItem.sku,
      warehouse,
      qty: approvedQty,
      asnNumber: qItem.asnNumber || qItem.asnId,
      referenceId: putawayId,
      user: operator,
      company: req.user.company
    }], { session });

    // Activity Log & Notifications
    await logActivity(req, 'QC_PASSED', 'QC', `QC Passed for SKU ${qItem.sku} (${approvedQty} units moved to Awaiting Putaway)`, session);
    await logActivity(req, 'PUTAWAY_CREATED', 'PUTAWAY', `Generated Putaway Task ${putawayId} for SKU ${qItem.sku}`, session);

    Notification.create([{
      company: req.user.company,
      kind: 'success',
      title: 'QC Inspection Passed & Putaway Created',
      body: `${approvedQty} units of ${qItem.sku} passed QC and moved to Awaiting Putaway. Putaway Task ${putawayId} generated.`,
    }], { session }).catch(() => {});

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: `QC Passed for SKU ${qItem.sku}. Moved ${approvedQty} units to Awaiting Putaway and generated Putaway Task ${putawayId}.`,
      quarantineItem: qItem,
      putawayTask: putawayTask[0]
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── POST /api/v1/qc/:id/fail — FAIL QC INSPECTION (NO PUTAWAY TASK GENERATED) ──
router.post('/:id/fail', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const { failReason = 'Quality Inspection Failed' } = req.body;
    const qItem = await QuarantineInventory.findOne({ _id: req.params.id, company: req.user.company }).session(session);

    if (!qItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Quarantine record not found' });
    }

    // State Machine Lock
    if (!isValidQcStateTransition(qItem.status, 'qc_failed')) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Invalid state transition from '${qItem.status}' to 'qc_failed'.` });
    }

    const operator = req.user.email || req.user.name || 'system';

    qItem.status = 'qc_failed';
    qItem.failReason = failReason;
    await qItem.save({ session });

    if (qItem.inspectionId) {
      await QCInspection.findOneAndUpdate(
        { inspectionId: qItem.inspectionId, company: req.user.company },
        { status: 'qc_failed', failReason },
        { session }
      );
    }

    await InventoryTransaction.create([{
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      type: 'QC_FAIL',
      sku: qItem.sku,
      warehouse: qItem.warehouse || 'MIA',
      qty: qItem.qty,
      asnNumber: qItem.asnNumber || qItem.asnId,
      referenceId: qItem.inspectionId || qItem.quarantineId,
      user: operator,
      company: req.user.company
    }], { session });

    await logActivity(req, 'QC_FAILED', 'QC', `QC Failed for SKU ${qItem.sku} (${qItem.qty} units). Reason: ${failReason}`, session);

    Notification.create([{
      company: req.user.company,
      kind: 'alert',
      title: 'QC Inspection Failed',
      body: `SKU ${qItem.sku} (${qItem.qty} units) failed QC inspection. Stock remains quarantined.`,
    }], { session }).catch(() => {});

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: `QC Failed for SKU ${qItem.sku}. Stock remains quarantined. No putaway task generated.`,
      quarantineItem: qItem
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── POST /api/v1/qc/:id/return — RETURN TO VENDOR (DUPLICATE RTV BLOCK & RTV DOCUMENT GENERATION) ──
router.post('/:id/return', requireOpsRole, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const qItem = await QuarantineInventory.findOne({ _id: req.params.id, company: req.user.company }).session(session);

    if (!qItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Quarantine record not found' });
    }

    // Duplicate RTV Block
    if (qItem.status === 'returned_to_vendor' || qItem.rtvAuthNumber) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Duplicate RTV Blocked: Return To Vendor document (${qItem.rtvAuthNumber}) has already been generated for this item.` });
    }

    // State Machine Lock
    if (!isValidQcStateTransition(qItem.status, 'returned_to_vendor')) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Invalid state transition from '${qItem.status}' to 'returned_to_vendor'.` });
    }

    const { returnReason = 'RTV - Failed QC', rtvCarrier = 'DHL Freight' } = req.body;
    let { rtvAuthNumber } = req.body;

    // Generate sequential RTV document reference if not provided
    if (!rtvAuthNumber) {
      rtvAuthNumber = await nextRtvNumber(req.user.company, session);
    }

    const operator = req.user.email || req.user.name || 'system';
    const qty = qItem.qty;
    const warehouse = qItem.warehouse || 'MIA';

    // Remove from Quarantine Balance
    await InventoryBalance.findOneAndUpdate(
      { company: req.user.company, warehouse, sku: qItem.sku, owner: qItem.owner, ownerType: qItem.ownerType, lotNumber: qItem.lotNumber || 'DEFAULT-LOT', bin: qItem.bin || `${warehouse}-RCV-DOCK1` },
      { $inc: { qtyQuarantine: -qty } },
      { upsert: true, new: true, session }
    );

    qItem.status = 'returned_to_vendor';
    qItem.failReason = returnReason;
    qItem.rtvAuthNumber = rtvAuthNumber;
    qItem.rtvCarrier = rtvCarrier;
    await qItem.save({ session });

    if (qItem.inspectionId) {
      await QCInspection.findOneAndUpdate(
        { inspectionId: qItem.inspectionId, company: req.user.company },
        { status: 'returned_to_vendor', rtvAuthNumber, rtvCarrier, failReason: returnReason },
        { session }
      );
    }

    await InventoryTransaction.create([{
      transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      type: 'RETURN_TO_VENDOR',
      sku: qItem.sku,
      warehouse,
      qty,
      asnNumber: qItem.asnNumber || qItem.asnId,
      referenceId: rtvAuthNumber,
      user: operator,
      company: req.user.company
    }], { session });

    await logActivity(req, 'RTV_CREATED', 'QC', `Returned ${qty} units of SKU ${qItem.sku} to vendor (RTV Document: ${rtvAuthNumber})`, session);

    Notification.create([{
      company: req.user.company,
      kind: 'info',
      title: 'Return To Vendor Document Generated',
      body: `${qty} units of ${qItem.sku} returned to vendor under RTV Document ${rtvAuthNumber}.`,
    }], { session }).catch(() => {});

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: `Successfully processed Return To Vendor for SKU ${qItem.sku} (${qty} units). RTV Reference Document: ${rtvAuthNumber}.`,
      quarantineItem: qItem,
      rtvDocumentNumber: rtvAuthNumber
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

export default router;
