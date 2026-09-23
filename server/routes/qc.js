import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole, requireOfficeAccess } from '../middleware/auth.js';
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
import AuditLog from '../models/AuditLog.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { putawayEngine, resolveStagingFallback } from '../services/putawayEngine.js';
import QCProfile from '../models/QCProfile.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager', 'warehouse_staff');
const blockOffice = requireOfficeAccess;

/** Atomic Sequential QC Number: QC-000001, QC-000002... */
async function nextQcNumber(company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: `qc_${company}`, company },
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
    { _id: `putaway_${company}`, company },
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
    { _id: `rtv_${company}`, company },
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

// ── QC Profiles (G-03 Dynamic QC Profiles) ──

const DEFAULT_QC_PROFILES = [
  {
    name: 'Standard QC',
    description: 'Standard consumer goods visual and condition inspection',
    fields: [
      { name: 'packagingCondition', label: 'Packaging Condition', type: 'select', options: ['Intact', 'Damaged', 'Opened'], required: true },
      { name: 'productCondition', label: 'Product Condition', type: 'select', options: ['Good', 'Defective', 'Wrong Item'], required: true },
      { name: 'visualInspection', label: 'Visual Inspection Passed', type: 'boolean', required: true }
    ]
  },
  {
    name: 'Cold Chain QC',
    description: 'Perishable, refrigerated and frozen items temperature compliance',
    fields: [
      { name: 'temperatureReading', label: 'Arrival Temperature (°C)', type: 'number', required: true },
      { name: 'humidityLevel', label: 'Relative Humidity (%)', type: 'number', required: true },
      { name: 'dataLogger', label: 'Data Logger S/N', type: 'text', required: false }
    ]
  },
  {
    name: 'Electronics / Equipment QC',
    description: 'High-tech and electronic devices functional & serial verification',
    fields: [
      { name: 'functionalTest', label: 'Functional Test Passed', type: 'boolean', required: true },
      { name: 'serialNumber', label: 'Serial Number Verification', type: 'text', required: true }
    ]
  }
];

router.get('/profiles', async (req, res, next) => {
  try {
    let profiles = await QCProfile.find({ company: req.user.company });
    if (profiles.length === 0) {
      try {
        await QCProfile.insertMany(
          DEFAULT_QC_PROFILES.map(p => ({ ...p, company: req.user.company })),
          { ordered: false }
        );
        profiles = await QCProfile.find({ company: req.user.company });
      } catch (_) {}
    }
    res.json(profiles);
  } catch (err) { next(err); }
});

router.post('/profiles', requireOpsRole, async (req, res, next) => {
  try {
    const profile = await QCProfile.create({ ...req.body, company: req.user.company });
    res.status(201).json(profile);
  } catch (err) { next(err); }
});

router.put('/profiles/:id', requireOpsRole, async (req, res, next) => {
  try {
    const profile = await QCProfile.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      req.body,
      { new: true }
    );
    if (!profile) return res.status(404).json({ message: 'Profile not found' });
    res.json(profile);
  } catch (err) { next(err); }
});

router.delete('/profiles/:id', requireOpsRole, async (req, res, next) => {
  try {
    const profile = await QCProfile.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });
    res.json({ message: 'Profile deleted' });
  } catch (err) { next(err); }
});

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
router.post('/', requireOpsRole, blockOffice, async (req, res, next) => {
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

    // G-03: Resolve QC Profile for dynamic field initialization
    // Look up the product to find its qc_profile name, then resolve to a QCProfile document
    let resolvedProfileId = null;
    let resolvedProfileName = '';
    let initialDynamicFields = {};

    const productDoc = await Product.findOne({ sku: qItem.sku, company: req.user.company }).session(session);
    if (productDoc && productDoc.qc_profile) {
      const profileDoc = await QCProfile.findOne({
        name: productDoc.qc_profile,
        company: req.user.company
      }).session(session);

      if (profileDoc) {
        resolvedProfileId = profileDoc._id;
        resolvedProfileName = profileDoc.name;
        // Initialize each required field in the profile as null so inspectors see the full checklist
        for (const field of (profileDoc.fields || [])) {
          initialDynamicFields[field.name] = null;
        }
      }
    }

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
      qcProfileId: resolvedProfileId || undefined,
      qcProfileName: resolvedProfileName,
      dynamicFields: initialDynamicFields,
      company: req.user.company
    }], { session });

    await logActivity(req, 'QC_STARTED', 'QC', `Started inspection ${qcId} for SKU ${qItem.sku} (${qItem.qty} units)${resolvedProfileName ? ` using profile "${resolvedProfileName}"` : ''}`, session);

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
router.put('/:id', requireOpsRole, blockOffice, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const inspection = await QCInspection.findOne({ _id: req.params.id, company: req.user.company });
    if (!inspection) return res.status(404).json({ message: 'Inspection not found' });

    // Block updating completed inspections
    if (inspection.status === 'qc_passed' || inspection.status === 'qc_failed' || inspection.status === 'returned_to_vendor') {
      return res.status(400).json({ message: `Cannot modify inspection in terminal state '${inspection.status}'.` });
    }

    if (req.body.dynamicFields) {
      if (!inspection.dynamicFields) inspection.dynamicFields = new Map();
      for (const [k, v] of Object.entries(req.body.dynamicFields)) {
        inspection.dynamicFields.set(k, v);
      }
      delete req.body.dynamicFields;
    }
    Object.assign(inspection, req.body);
    const updated = await inspection.save();

    await logActivity(req, 'INSPECTION_UPDATED', 'QC', `Updated inspection details for ${updated.inspectionId}`);

    res.json(updated);
  } catch (err) { next(err); }
});

// ── POST /api/v1/qc/:id/pass — PASS QC & TRANSITION TO AWAITING_PUTAWAY (PUTAWAY TASK GENERATED ONLY ON QC PASS) ──
router.post('/:id/pass', requireOpsRole, blockOffice, async (req, res, next) => {
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

    const inspectionDoc = await QCInspection.findOne({ inspectionId: qItem.inspectionId, company: req.user.company }).session(session);
    
    // Check required dynamic fields from QCProfile
    if (inspectionDoc && inspectionDoc.qcProfileId) {
      const profile = await QCProfile.findById(inspectionDoc.qcProfileId).session(session);
      if (profile) {
        const missingFields = [];
        for (const field of profile.fields) {
          if (field.required) {
            const val = inspectionDoc.dynamicFields ? inspectionDoc.dynamicFields.get(field.name) : undefined;
            if (val === null || val === undefined || val === '') {
              missingFields.push(field.label || field.name);
            }
          }
        }
        if (missingFields.length > 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: `Cannot approve QC. Missing required profile fields: ${missingFields.join(', ')}` });
        }
      }
    }

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

    // Check Electronics / Equipment profile validation
    const isElectronics = Boolean(prodDoc && (prodDoc.category === 'ELECTRONIC' || prodDoc.qc_profile === 'Electronics / Equipment')) ||
      Boolean(inspectionDoc?.qcProfileName?.includes('Electronic'));

    if (isElectronics) {
      const funcCheck = req.body.functionalCheck !== undefined ? req.body.functionalCheck : req.body.functionalTest;
      if (funcCheck === undefined || funcCheck === null || funcCheck === false || funcCheck === 'false') {
        await session.abortTransaction();
        session.endSession();
        return res.status(422).json({
          message: 'BLOCKED: Functional test verification is required for Electronics / Equipment QC.'
        });
      }
      const serials = req.body.serialNumbers || req.body.serialNumber;
      if (!serials || (typeof serials === 'string' && !serials.trim())) {
        await session.abortTransaction();
        session.endSession();
        return res.status(422).json({
          message: 'BLOCKED: Serial number verification is required for Electronics / Equipment QC.'
        });
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

    // 1. Pipeline Refinement: Move ONLY approvedQty from qtyQuarantine -> qtyAwaitingPutaway
    // The rejectedQty remains in qtyQuarantine, maintaining physical traceability!
    await InventoryBalance.findOneAndUpdate(
      { company: req.user.company, warehouse, sku: qItem.sku, owner: qItem.owner, ownerType: qItem.ownerType, lotNumber: qItem.lotNumber || 'DEFAULT-LOT', bin: qItem.bin || `${warehouse}-RCV-DOCK1` },
      { $inc: { qtyQuarantine: -approvedQty, qtyAwaitingPutaway: approvedQty } },
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
      
      // Clone QuarantineInventory to track the rejected portion
      await QuarantineInventory.create([{
        quarantineId: qItem.quarantineId + '-REJ',
        asnId: qItem.asnId,
        asnNumber: qItem.asnNumber,
        sku: qItem.sku,
        productName: qItem.productName,
        warehouse: qItem.warehouse,
        bin: qItem.bin,
        qty: rejectedQty,
        lotNumber: qItem.lotNumber,
        batchNumber: qItem.batchNumber,
        expiryDate: qItem.expiryDate,
        owner: qItem.owner,
        ownerType: qItem.ownerType,
        status: 'qc_failed',
        failReason: `Partial Rejection from ${qItem.quarantineId}`,
        company: req.user.company
      }], { session });
    }

    // 3. Update QuarantineInventory Status -> awaiting_putaway for the approved part
    qItem.status = 'awaiting_putaway';
    qItem.qty = approvedQty;
    await qItem.save({ session });

    if (inspectionDoc) {
      inspectionDoc.status = 'qc_passed';
      inspectionDoc.notes = notes || `Inspection Passed (${approvedQty} approved, ${rejectedQty} rejected)`;
      if (arrivalTemp !== undefined) inspectionDoc.arrivalTemp = Number(arrivalTemp);
      if (minTemp !== undefined) inspectionDoc.minTemp = Number(minTemp);
      if (maxTemp !== undefined) inspectionDoc.maxTemp = Number(maxTemp);
      if (humidityPct !== undefined) inspectionDoc.humidityPct = Number(humidityPct);
      inspectionDoc.dataLogger = dataLogger || '';
      inspectionDoc.tempRangeMin = Number(tempRangeMin);
      inspectionDoc.tempRangeMax = Number(tempRangeMax);
      inspectionDoc.approvedQty = approvedQty;
      inspectionDoc.rejectedQty = rejectedQty;
      inspectionDoc.rejectionDestination = rejectionDestination || '';
      inspectionDoc.attachments = Array.isArray(attachments) ? attachments : [];
      
      await inspectionDoc.save({ session });
    }

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

    // 4. DYNAMIC LOCATION PROPOSAL & AUTOMATIC PUTAWAY TASK GENERATION (PUT-000001) FOR APPROVED STOCK ONLY
    const proposed = await putawayEngine.evaluatePutawayLocation({
      companyId: req.user.company,
      warehouse: qItem.warehouse,
      sku: qItem.sku,
      owner: itemOwner,
      qty: approvedQty,
      lotNumber: qItem.lotNumber
    });

    const fromBinCode = qItem.bin || `${warehouse}-RCV-DOCK1`;

    // RF-P01: Fall back to staging location if engine finds no valid putaway destination
    let toBinCode = proposed.proposedBin;
    if (!toBinCode) {
      try {
        toBinCode = await resolveStagingFallback(req.user.company, qItem.warehouse);
      } catch (stagingErr) {
        await session.abortTransaction();
        session.endSession();
        return res.status(422).json({
          message: `RF-P01: ${stagingErr.message}`,
          sku: qItem.sku,
          warehouse
        });
      }
    }

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
router.post('/:id/fail', requireOpsRole, blockOffice, async (req, res, next) => {
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

// ── POST /api/v1/qc/:id/recondition — START RECONDITIONING WORKFLOW (RF-P17) ──
router.post('/:id/recondition', requireOpsRole, blockOffice, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const { reconditionInstructions, reconditionReason, operator } = req.body;
    
    if (!reconditionInstructions || !reconditionInstructions.trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Reconditioning instructions are required' });
    }

    const qItem = await QuarantineInventory.findOne({ _id: req.params.id, company: req.user.company }).session(session);

    if (!qItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Quarantine record not found' });
    }

    // State Machine Lock: can only recondition from qc_failed or pending_qc
    if (!['qc_failed', 'pending_qc', 'under_inspection'].includes(qItem.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Invalid status transition from '${qItem.status}' to reconditioning. Only qc_failed or pending_qc items can be reconditioned.` });
    }

    const operatorName = operator || req.user?.name || req.user?.email || 'system';

    // Update status to reconditioning
    qItem.status = 'qc_failed'; // Keep as qc_failed but with recondition flag
    qItem.failReason = reconditionReason || 'Reconditioning Required';
    await qItem.save({ session });

    // Update inspection with reconditioning data
    if (qItem.inspectionId) {
      await QCInspection.findOneAndUpdate(
        { inspectionId: qItem.inspectionId, company: req.user.company },
        { 
          status: 'qc_failed',
          failReason: reconditionReason || 'Reconditioning Required',
          // Store reconditioning metadata in dynamic fields or notes
          notes: `RECONDITIONING - Instructions: ${reconditionInstructions}. Operator: ${operatorName}. Started: ${new Date().toISOString()}`
        },
        { session }
      );
    }

    // Record audit event for reconditioning (RF-P17)
    await AuditLog.create([{
      event_id: 'EVT-QC-REC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date(),
      event_type: 'qc_recondition',
      user_id: req.user?._id,
      user_name: operatorName,
      lot_number: qItem.lotNumber,
      quantity: qItem.qty,
      reference_id: qItem.quarantineId,
      reason_text: `Reconditioning started for SKU ${qItem.sku}: ${reconditionInstructions}`,
      company: req.user.company
    }], { session });

    await logActivity(req, 'RECONDITIONING_STARTED', 'QC', `Reconditioning started for SKU ${qItem.sku} (${qItem.qty} units)`, session);

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: `Reconditioning workflow started for SKU ${qItem.sku}. Instructions recorded.`,
      quarantineItem: qItem,
      reconditioning: {
        instructions: reconditionInstructions,
        reason: reconditionReason,
        operator: operatorName,
        startedAt: new Date()
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── POST /api/v1/qc/:id/recondition/complete — COMPLETE RECONDITIONING & FINAL INSPECTION (RF-P17) ──
router.post('/:id/recondition/complete', requireOpsRole, blockOffice, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const { reconditionResult, finalInspector, finalDecision } = req.body;
    
    if (!finalDecision || !['approve', 'reject'].includes(finalDecision)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Final decision (approve/reject) is required' });
    }

    const qItem = await QuarantineInventory.findOne({ _id: req.params.id, company: req.user.company }).session(session);

    if (!qItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Quarantine record not found' });
    }

    const operatorName = finalInspector || req.user?.name || req.user?.email || 'system';
    const warehouse = qItem.warehouse || 'MIA';

    if (finalDecision === 'approve') {
      // Final approve after reconditioning - follow QC pass logic
      const approvedQty = qItem.qty;
      
      // Move from qtyQuarantine -> qtyAwaitingPutaway
      await InventoryBalance.findOneAndUpdate(
        { company: req.user.company, warehouse, sku: qItem.sku, owner: qItem.owner, ownerType: qItem.ownerType, lotNumber: qItem.lotNumber || 'DEFAULT-LOT', bin: qItem.bin || `${warehouse}-RCV-DOCK1` },
        { $inc: { qtyQuarantine: -approvedQty, qtyAwaitingPutaway: approvedQty } },
        { upsert: true, new: true, session }
      );

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
        user: operatorName,
        notes: `Reconditioning completed and approved: ${reconditionResult}`,
        company: req.user.company
      }], { session });

      // Generate putaway task
      const putawayId = await nextPutawayNumber(req.user.company, session);
      const putawayTask = await PutawayTask.create([{
        taskId: putawayId,
        qcId: qItem.inspectionId || qItem.quarantineId,
        asnId: qItem.asnId,
        asnNumber: qItem.asnNumber,
        supplier: '',
        owner: qItem.owner,
        ownerType: qItem.ownerType || 'UNKNOWN',
        sku: qItem.sku,
        productName: qItem.productName,
        warehouse,
        qty: approvedQty,
        lotNumber: qItem.lotNumber,
        batchNumber: qItem.batchNumber,
        fromLocation: qItem.bin || `${warehouse}-RCV-DOCK1`,
        toLocation: 'Z-RECEIVING',
        destinationBin: 'Z-RECEIVING',
        priority: 'normal',
        status: 'pending',
        createdBy: operatorName,
        company: req.user.company
      }], { session });

      qItem.status = 'awaiting_putaway';
      await qItem.save({ session });

      await logActivity(req, 'RECONDITIONING_APPROVED', 'QC', `Reconditioning approved for SKU ${qItem.sku}. Putaway task ${putawayId} created.`, session);

      res.json({
        message: `Reconditioning approved for SKU ${qItem.sku}. Stock moved to Awaiting Putaway. Putaway Task ${putawayId} created.`,
        quarantineItem: qItem,
        putawayTask: putawayTask[0]
      });

    } else {
      // Final reject after reconditioning - follow QC fail logic
      qItem.status = 'qc_failed';
      qItem.failReason = `Reconditioning failed: ${reconditionResult}`;
      await qItem.save({ session });

      await InventoryTransaction.create([{
        transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
        type: 'QC_FAIL',
        sku: qItem.sku,
        warehouse: qItem.warehouse || 'MIA',
        qty: qItem.qty,
        asnNumber: qItem.asnNumber || qItem.asnId,
        referenceId: qItem.inspectionId || qItem.quarantineId,
        user: operatorName,
        company: req.user.company
      }], { session });

      await logActivity(req, 'RECONDITIONING_REJECTED', 'QC', `Reconditioning rejected for SKU ${qItem.sku}. Stock remains quarantined.`, session);

      res.json({
        message: `Reconditioning rejected for SKU ${qItem.sku}. Stock remains quarantined.`,
        quarantineItem: qItem
      });
    }

    await session.commitTransaction();
    session.endSession();

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// ── POST /api/v1/qc/:id/return — RETURN TO VENDOR (DUPLICATE RTV BLOCK & RTV DOCUMENT GENERATION) ──
router.post('/:id/return', requireOpsRole, blockOffice, async (req, res, next) => {
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
