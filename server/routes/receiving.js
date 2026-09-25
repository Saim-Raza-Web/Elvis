import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole, requireOfficeAccess } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import ASN from '../models/ASN.js';
import Counter from '../models/Counter.js';
import Notification from '../models/Notification.js';
import ActivityLog from '../models/ActivityLog.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import ReceivingHistory from '../models/ReceivingHistory.js';
import Discrepancy from '../models/Discrepancy.js';
import Incident from '../models/Incident.js';
import QuarantineInventory from '../models/QuarantineInventory.js';
import Product from '../models/Product.js';
import { validateOwnerMaster } from '../utils/ownerValidation.js';
import PutawayTask from '../models/PutawayTask.js';
import Company from '../models/Company.js';
import Warehouse from '../models/Warehouse.js';
import IdempotencyRecord from '../models/IdempotencyRecord.js';
import { generateInboundDeliveryNote } from '../services/deliveryNoteService.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { putawayEngine, resolveStagingFallback } from '../services/putawayEngine.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);

const requireOpsRole = requireRole('admin', 'manager');
const blockOffice = requireOfficeAccess;

// ── Helpers ──────────────────────────────────────────────────

/** Atomic Sequential ASN Number: ASN-YYYY-XXXXXX (e.g. ASN-2026-000001) */
async function nextAsnNumber(company, session) {
  const currentYear = new Date().getFullYear();
  const counterKey = `asn_${currentYear}_${company}`;
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey, company },
    { $inc: { seq: 1 } },
    opts
  );
  return `ASN-${currentYear}-${String(counter.seq).padStart(6, '0')}`;
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

/** Atomic Sequential PO Number: PO-2026-00001, PO-2026-00002... */
export async function nextPoNumber(company, session) {
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) opts.session = session;
  const currentYear = new Date().getFullYear();
  const counterId = `po_${currentYear}`;
  let attempts = 0;
  while (attempts < 20) {
    const counter = await Counter.findOneAndUpdate(
      { _id: `${counterId}_${company}`, company },
      { $inc: { seq: 1 } },
      opts
    );
    const poNumber = `PO-${currentYear}-${String(counter.seq).padStart(5, '0')}`;
    const query = { company, $or: [{ poNumber }, { po: poNumber }] };
    const existing = session ? await ASN.findOne(query).session(session) : await ASN.findOne(query);
    if (!existing) return poNumber;
    attempts++;
  }
  return `PO-${currentYear}-${Date.now().toString().slice(-5)}`;
}

/** Log activity */
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

/** Validate ASN Payload */
function validateAsnPayload(body) {
  const errors = [];
  const { supplier, owner, ownerType, poNumber, po, expectedDate, expected_date, receivingDock, items } = body;
  
  if (!supplier || !String(supplier).trim()) errors.push('Supplier is required.');
  if (!owner || !String(owner).trim()) errors.push('Owner (3PL) is required.');
  if (!ownerType || !['COMPANY', 'CUSTOMER'].includes(ownerType)) errors.push('Valid Owner Type (COMPANY or CUSTOMER) is required.');
  const actualPo = poNumber || po;
  if (!actualPo || !String(actualPo).trim()) errors.push('Purchase Order number is required.');

  const actualDate = expectedDate || expected_date;
  if (!actualDate || isNaN(new Date(actualDate).getTime())) errors.push('Valid Expected Arrival Date is required.');
  if (!receivingDock || !String(receivingDock).trim()) errors.push('Receiving Dock is required.');

  if (!Array.isArray(items) || items.length === 0) {
    errors.push('At least one product line is required.');
  } else {
    items.forEach((line, idx) => {
      if (!line.sku || !String(line.sku).trim()) errors.push(`Line ${idx + 1}: SKU is required.`);
      if (!line.name || !String(line.name).trim()) errors.push(`Line ${idx + 1}: Product name is required.`);
      if (!line.expected_qty || Number(line.expected_qty) <= 0) errors.push(`Line ${idx + 1}: Expected quantity must be greater than 0.`);
      if (!line.uom || !String(line.uom).trim()) errors.push(`Line ${idx + 1}: Unit of Measure (UOM) is required.`);
      if (line.expiryDate && isNaN(new Date(line.expiryDate).getTime())) errors.push(`Line ${idx + 1}: Invalid expiry date.`);
    });
  }

  return errors;
}

/** Validate Status Transition State Machine */
function isValidStatusTransition(currentStatus, newStatus, userRole) {
  if (currentStatus === newStatus) return true;
  if (userRole === 'admin') return true; // Admin override option

  const TRANSITION_MAP = {
    pending: ['in_progress', 'completed', 'cancelled'],
    in_progress: ['completed', 'completed_with_discrepancies', 'cancelled'],
    completed: [], // Terminal state
    completed_with_discrepancies: [], // Terminal state
    cancelled: [] // Terminal state
  };

  const allowedNext = TRANSITION_MAP[currentStatus] || [];
  return allowedNext.includes(newStatus);
}

/** H-03: ASN Product Search / Autofill */
async function autofillAsnProducts(items, company) {
  const errors = [];
  if (!Array.isArray(items)) return errors;
  for (const line of items) {
    if (line.sku) {
      const product = await Product.findOne({
        company,
        $or: [
          { sku: line.sku },
          { unitBarcode: line.sku },
          { caseBarcode: line.sku }
        ]
      });
      if (product) {
        // H-03: EAN-to-SKU resolution and multiplier handling
        if (line.sku === product.caseBarcode && product.caseMultiplier > 1) {
          line.expected_qty = (line.expected_qty || 0) * product.caseMultiplier;
          if (line.received_qty !== undefined && line.received_qty !== null) {
            line.received_qty = line.received_qty * product.caseMultiplier;
          }
        }
        
        line.sku = product.sku;
        line.name = line.name || product.name || product.description;
        line.description = line.description || product.description;
        line.uom = line.uom || product.base_uom;
      } else {
        errors.push(`Unknown SKU or Barcode: ${line.sku}`);
      }
    }
  }
  return errors;
}

// ── Helpers: H-02 Blind Receiving Redaction ──────────────────

/**
 * H-02: Blind Receiving Redaction Helper
 *
 * For warehouse operators (role === 'warehouse_staff' or non-admin/non-manager):
 * When an ASN's warehouse has blindReceiving === true (or company blindReceiving fallback),
 * strictly delete expected quantities:
 *   - expected_units (and aliases)
 *   - items[].expected_qty (and aliases)
 *
 * For managers/admins or non-blind warehouses:
 *   Expected quantities remain completely visible.
 *
 * Safely handles both single documents and arrays (multi-warehouse list responses).
 */
async function sanitizeAsnBlindReceiving(asnData, user, companyId) {
  if (!asnData) return asnData;

  const isOperator = user?.role === 'warehouse_staff' || (user?.role !== 'admin' && user?.role !== 'manager');
  const isArray = Array.isArray(asnData);
  const rawList = isArray ? asnData : [asnData];

  if (rawList.length === 0) return isArray ? [] : null;

  // Collect unique warehouse codes / IDs present in the ASN list
  const whCodesOrIds = [...new Set(rawList.map(a => a?.warehouse).filter(Boolean))];

  // Batch query warehouse documents for tenant
  const objectIds = whCodesOrIds.filter(id => mongoose.Types.ObjectId.isValid(id) && String(id).length === 24);
  const warehouses = await Warehouse.find({
    company: companyId,
    $or: [
      { code: { $in: whCodesOrIds } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])
    ]
  }).lean();

  const companyDoc = await Company.findById(companyId).select('blindReceiving').lean();
  const companyDefaultBlind = Boolean(companyDoc?.blindReceiving);

  const blindMap = new Map();
  for (const wh of warehouses) {
    const isBlind = wh.blindReceiving !== undefined ? Boolean(wh.blindReceiving) : companyDefaultBlind;
    if (wh.code) blindMap.set(wh.code, isBlind);
    if (wh._id) blindMap.set(wh._id.toString(), isBlind);
  }

  const sanitized = rawList.map(asnDoc => {
    let item = asnDoc?.toObject ? asnDoc.toObject() : { ...asnDoc };

    const whIdentifier = item.warehouse;
    const isBlind = whIdentifier && blindMap.has(whIdentifier)
      ? blindMap.get(whIdentifier)
      : companyDefaultBlind;

    item.blindReceiving = isBlind;

    if (isOperator && isBlind) {
      delete item.expected_units;
      delete item.expectedUnits;
      delete item.expected_quantity;
      delete item.expectedQuantity;

      if (Array.isArray(item.items)) {
        item.items = item.items.map(line => {
          const lineCopy = line?.toObject ? line.toObject() : { ...line };
          delete lineCopy.expected_qty;
          delete lineCopy.expectedQty;
          delete lineCopy.expected_quantity;
          delete lineCopy.expectedQuantity;
          return lineCopy;
        });
      }
    }

    return item;
  });

  return isArray ? sanitized : sanitized[0];
}

// ── Routes ────────────────────────────────────────────────────

// GET List (with search, filter, pagination, sorting)
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    // Exclude soft-deleted documents
    const query = { company: req.user.company, isDeleted: { $ne: true } };

    // Search filter
    if (req.query.search) {
      const s = String(req.query.search).trim();
      const regex = new RegExp(s, 'i');
      query.$or = [
        { asnId: regex },
        { asnNumber: regex },
        { supplier: regex },
        { poNumber: regex },
        { po: regex },
        { carrier: regex },
        { 'items.sku': regex },
        { 'items.name': regex },
        { status: regex }
      ];
    }

    // Status filter
    if (req.query.status && req.query.status !== 'All') {
      query.status = req.query.status;
    }

    // Supplier filter
    if (req.query.supplier) {
      query.supplier = new RegExp(String(req.query.supplier).trim(), 'i');
    }

    // Warehouse filter
    if (req.query.warehouse) {
      query.warehouse = req.query.warehouse;
    } else if (req.context?.warehouse?.code) {
      query.warehouse = req.context.warehouse.code;
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      query.expectedDate = {};
      if (req.query.startDate) query.expectedDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) query.expectedDate.$lte = new Date(req.query.endDate);
    }

    const result = await paginateQuery(ASN, query, req);

    // H-02: Redact blind receiving data per ASN warehouse for operators
    if (Array.isArray(result.data)) {
      result.data = await sanitizeAsnBlindReceiving(result.data, req.user, req.user.company);
    }

    res.json(result);
  } catch (err) { next(err); }
});


// GET Next ASN Number (Preview only — does not increment counter on preview)
router.get('/next-asn', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const currentYear = new Date().getFullYear();
    const counterKey = `asn_${currentYear}_${req.user.company}`;
    const counter = await Counter.findOne({ _id: counterKey, company: req.user.company });
    const nextSeq = (counter?.seq || 0) + 1;
    const asnNumber = `ASN-${currentYear}-${String(nextSeq).padStart(6, '0')}`;
    res.json({ asnNumber });
  } catch (err) { next(err); }
});

// GET Next PO Number (Preview only — does not increment counter on preview)
router.get('/next-po', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const currentYear = new Date().getFullYear();
    const counterId = `po_${currentYear}`;
    const counter = await Counter.findOne({ _id: `${counterId}_${req.user.company}`, company: req.user.company });
    const nextSeq = (counter?.seq || 0) + 1;
    const poNumber = `PO-${currentYear}-${String(nextSeq).padStart(5, '0')}`;
    res.json({ poNumber });
  } catch (err) { next(err); }
});

// GET Details by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const item = await ASN.findOne({ _id: req.params.id, company: req.user.company, isDeleted: { $ne: true } });
    if (!item) return res.status(404).json({ message: 'ASN not found' });

    // H-02: Unified blind receiving redaction
    const responseItem = await sanitizeAsnBlindReceiving(item, req.user, req.user.company);
    res.json(responseItem);
  } catch (err) { next(err); }
});

// GET Receiving History for ASN
router.get('/:id/history', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const asn = await ASN.findOne({ _id: req.params.id, company: req.user.company });
    if (!asn) return res.status(404).json({ message: 'ASN not found' });

    const history = await ReceivingHistory.find({
      asnId: asn.asnId || asn.asnNumber,
      company: req.user.company
    }).sort({ timestamp: -1 });

    res.json(history);
  } catch (err) { next(err); }
});

// GET Discrepancies for ASN
router.get('/:id/discrepancies', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const asn = await ASN.findOne({ _id: req.params.id, company: req.user.company });
    if (!asn) return res.status(404).json({ message: 'ASN not found' });

    const discrepancies = await Discrepancy.find({
      asnId: asn.asnId || asn.asnNumber,
      company: req.user.company
    }).sort({ createdAt: -1 });

    res.json(discrepancies);
  } catch (err) { next(err); }
});

// CREATE ASN (uses document.save() for middleware execution)
router.post('/', requireOpsRole, blockOffice, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const data = { ...req.body, company: req.user.company };

    if (!data.poNumber && !data.po) {
      const generatedPO = await nextPoNumber(req.user.company);
      data.poNumber = generatedPO;
      data.po = generatedPO;
    } else {
      data.poNumber = data.poNumber || data.po;
      data.po = data.po || data.poNumber;
    }

    // H-03: ASN Product Autofill & EAN-to-SKU mapping
    const autofillErrors = await autofillAsnProducts(data.items, req.user.company);
    if (autofillErrors.length > 0) {
      return res.status(400).json({ message: autofillErrors.join(' ') });
    }

    const validationErrors = validateAsnPayload(data);
    if (validationErrors.length > 0) {
      return res.status(400).json({ message: validationErrors.join(' ') });
    }

    // H-01: ASN Automation - ALWAYS force generated numbers to prevent duplicates
    const generatedNumber = await nextAsnNumber(req.user.company);
    data.asnId = generatedNumber;
    data.asnNumber = generatedNumber;

    // G-01: Central Client/Owner Master Enforcement
    const ownerError = await validateOwnerMaster(data.owner, data.ownerType, req.user.company);
    if (ownerError) {
      return res.status(400).json({ message: ownerError });
    }

    data.expectedDate = data.expectedDate || data.expected_date;
    data.expected_date = data.expected_date || data.expectedDate;
    data.expectedDate = data.expectedDate || data.expected_date;
    data.expected_date = data.expected_date || data.expectedDate;
    data.status = data.status || 'pending';
    data.createdBy = req.user.email || req.user.name || 'system';

    const asnDoc = new ASN(data);
    const item = await asnDoc.save();

    // Notification
    Notification.create({
      company: req.user.company,
      kind: 'info',
      title: 'New ASN Created',
      body: `ASN ${item.asnId} created for supplier ${item.supplier}`,
    }).catch(() => {});

    // Activity log
    await logActivity(req, 'CREATE', 'ASN', `Created ASN ${item.asnId} for supplier ${item.supplier} (${item.items?.length || 0} product lines)`);

    res.status(201).json(item);
  } catch (err) { next(err); }
});

// ── PHASE 2 PHYSICAL GOODS RECEIVING EXECUTION (WITH TRANSACTIONS & IDEMPOTENCY) ──
router.post('/:id/receive', requireOpsRole, async (req, res, next) => {
  const { receiveItems, __v, idempotencyKey } = req.body;

  // 1. Persistent DB-backed Idempotency Check
  let idempotencyDoc;
  if (idempotencyKey) {
    try {
      idempotencyDoc = await IdempotencyRecord.create({
        company: req.user.company,
        idempotencyKey,
        operation: 'receive_asn',
        requestPath: req.originalUrl,
        status: 'processing'
      });
    } catch (err) {
      if (err.code === 11000) {
        const existing = await IdempotencyRecord.findOne({ company: req.user.company, idempotencyKey, operation: 'receive_asn' });
        if (existing) {
          if (existing.status === 'completed') {
             return res.status(existing.responseStatus || 200).json(existing.responsePayload);
          }
          if (existing.status === 'processing') {
             return res.status(409).json({ message: 'Concurrent request processing for the same idempotency key.' });
          }
          idempotencyDoc = await IdempotencyRecord.findOneAndUpdate(
            { _id: existing._id },
            { status: 'processing' },
            { new: true }
          );
        }
      } else {
        return next(err);
      }
    }
  }

  // Helper function to send response and commit idempotency safely
  const sendIdempotentResponse = async (status, payload) => {
    if (idempotencyDoc) {
       await IdempotencyRecord.findByIdAndUpdate(idempotencyDoc._id, {
         status: 'completed',
         responseStatus: status,
         responsePayload: payload
       }).catch(() => {}); // fire and forget log
    }
    return res.status(status).json(payload);
  };
  
  // Intercept normal res returns and use sendIdempotentResponse
  const originalJson = res.json;
  res.json = function(body) {
     if (res.statusCode < 400 && idempotencyDoc) {
       IdempotencyRecord.findByIdAndUpdate(idempotencyDoc._id, {
         status: 'completed',
         responseStatus: res.statusCode,
         responsePayload: body
       }).catch(() => {});
     } else if (res.statusCode >= 400 && idempotencyDoc) {
       IdempotencyRecord.findByIdAndUpdate(idempotencyDoc._id, {
         status: 'failed',
         responseStatus: res.statusCode,
         responsePayload: body
       }).catch(() => {});
     }
     return originalJson.call(this, body);
  };


  if (!Array.isArray(receiveItems) || receiveItems.length === 0) {
    return res.status(400).json({ message: 'At least one line item must be submitted for receiving.' });
  }

  // 2. Start Mongoose Transaction Session for All-or-Nothing Atomic Rollback
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.user?.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const isObjId = mongoose.Types.ObjectId.isValid(req.params.id);
    const asn = await ASN.findOne({
      $or: [
        ...(isObjId ? [{ _id: req.params.id }] : []),
        { asnId: req.params.id },
        { asnNumber: req.params.id }
      ],
      company: req.user.company,
      isDeleted: { $ne: true }
    }).session(session);
    if (!asn) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'ASN not found' });
    }

    // OCC Conflict check
    if (__v !== undefined && asn.__v !== undefined && __v !== asn.__v) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        message: 'Conflict Detected: This ASN was modified by another operator. Please refresh and re-submit your receive operation.'
      });
    }

    if (asn.status === 'completed' || asn.status === 'completed_with_discrepancies' || asn.status === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Cannot receive items on an ASN with status '${asn.status}'.` });
    }

    const operator = req.user.email || req.user.name || 'system';
    const warehouse = asn.warehouse || 'MIA';

    let totalReceivedInSession = 0;
    let hasDiscrepancyInSession = false;

    // Loop through submitted lines
    for (const rItem of receiveItems) {
      const { sku, qtyToReceive, damagedQty = 0, lotNumber, batchNumber, expiryDate, bin = null, zone = null } = rItem;
      // Determine source receiving dock / staging bin vs proposed destination storage location
      const receivingDockName = asn.receivingDock || 'Dock 1';
      const receivingBin = `STAGING-A`;
      const receivingZone = zone || 'Z-RECEIVING';


      const qtyNum = Number(qtyToReceive);
      if (isNaN(qtyNum) || qtyNum <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Invalid quantity to receive for SKU ${sku}. Must be greater than 0.` });
      }

      const matchLine = asn.items.find(i => i.sku === sku);
      if (!matchLine) {
        // Automatically create Discrepancy, Incident, ActivityLog, and Notification for Unexpected SKU
        const discId = 'DISC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
        const incId = 'INC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);

        await Discrepancy.create([{
          discrepancyId: discId,
          asnId: asn.asnId || asn.asnNumber,
          asnNumber: asn.asnId || asn.asnNumber,
          sku,
          type: 'unexpected_sku',
          expectedQty: 0,
          receivedQty: 0,
          damagedQty: 0,
          difference: 0,
          notes: `Unexpected SKU '${sku}' scanned on ASN ${asn.asnId}`,
          user: operator,
          company: req.user.company
        }], { session });

        await Incident.create([{
          incidentId: incId,
          type: 'Discrepancy',
          sku,
          expectedSKU: 'N/A',
          scannedBarcode: sku,
          location: asn.receivingDock || 'Dock 1',
          warehouse,
          asnReference: asn.poNumber || asn.po || asn.asnId,
          asnId: asn.asnId || asn.asnNumber,
          supplier: asn.supplier,
          owner: asn.owner || 'Default Owner',
          operator,
          user: operator,
          reported_by: operator,
          reason: 'Unexpected SKU',
          module: 'Receiving',
          timestamp: new Date(),
          status: 'open',
          description: `Unexpected SKU '${sku}' scanned during receiving on ASN ${asn.asnId}`,
          company: req.user.company
        }], { session });

        Notification.create([{
          company: req.user.company,
          kind: 'alert',
          title: 'Unexpected SKU Detected',
          body: `SKU '${sku}' not found in ASN ${asn.asnId}. Discrepancy ${discId} and Incident ${incId} generated.`,
        }]).catch(() => {});

        await logActivity(req, 'DISCREPANCY_DETECTED', 'ASN', `Unexpected SKU '${sku}' scanned on ASN ${asn.asnId}. Discrepancy ${discId} and Incident ${incId} created.`, session);

        asn.status = 'completed_with_discrepancies';
        await asn.save({ session });

        await session.commitTransaction();
        session.endSession();

        return res.status(400).json({
          message: `REJECTED: SKU '${sku}' does not belong to ASN ${asn.asnId}. Discrepancy (${discId}) & Incident (${incId}) automatically created.`,
          discrepancyId: discId,
          incidentId: incId
        });
      }

      const currentReceived = matchLine.received_qty || 0;
      const expected = matchLine.expected_qty || 0;
      const remaining = expected - currentReceived;

      // Check Blind Receiving setting from Warehouse (with Company fallback)
      const whDoc = await Warehouse.findOne({ code: asn.warehouse || warehouse, company: req.user.company }).session(session);
      const companyDoc = await Company.findById(req.user.company).session(session);
      const isBlindReceiving = whDoc?.blindReceiving !== undefined ? Boolean(whDoc.blindReceiving) : Boolean(companyDoc?.blindReceiving);

      if (!isBlindReceiving && qtyNum > remaining) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: `Cannot receive ${qtyNum} units for SKU ${sku}. Maximum remaining expected quantity is ${remaining}.`
        });
      }

      // If Blind Receiving is ON and operator count differs from expected remaining
      if (isBlindReceiving && qtyNum !== remaining) {
        hasDiscrepancyInSession = true;
        const discId = 'DISC-BLIND-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
        const incId = 'INC-BLIND-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);

        await Discrepancy.create([{
          discrepancyId: discId,
          asnId: asn.asnId || asn.asnNumber,
          asnNumber: asn.asnId || asn.asnNumber,
          sku,
          type: 'quantity_discrepancy',
          expectedQty: remaining,
          receivedQty: qtyNum,
          damagedQty: Number(damagedQty) || 0,
          difference: qtyNum - remaining,
          notes: `Blind Receiving Discrepancy: Counted ${qtyNum} vs Expected ${remaining} for SKU '${sku}'`,
          user: operator,
          company: req.user.company
        }], { session });

        await Incident.create([{
          incidentId: incId,
          type: 'Discrepancy',
          sku,
          expectedSKU: sku,
          scannedBarcode: sku,
          location: asn.receivingDock || 'Dock 1',
          warehouse,
          asnReference: asn.poNumber || asn.po || asn.asnId,
          asnId: asn.asnId || asn.asnNumber,
          supplier: asn.supplier,
          owner: asn.owner || 'Default Owner',
          operator,
          user: operator,
          reported_by: operator,
          reason: 'Blind Receiving Quantity Mismatch',
          module: 'Receiving',
          timestamp: new Date(),
          status: 'open',
          description: `Blind Receiving discrepancy on ASN ${asn.asnId}. Counted: ${qtyNum}, Expected: ${remaining}.`,
          company: req.user.company
        }], { session });

        Notification.create([{
          company: req.user.company,
          kind: 'warning',
          title: 'Blind Receiving Discrepancy',
          body: `Blind Receiving discrepancy on ASN ${asn.asnId} for SKU ${sku}. Counted: ${qtyNum}, Expected: ${remaining}.`,
        }]).catch(() => {});

        await logActivity(req, 'BLIND_RECEIVING_DISCREPANCY', 'ASN', `Blind Receiving count discrepancy detected on ASN ${asn.asnId} (SKU ${sku}: Counted ${qtyNum}, Expected ${remaining}).`, session);
      }

      // 1. Update ASN line received_qty
      const beforeQty = currentReceived;
      matchLine.received_qty = currentReceived + qtyNum;
      if (lotNumber) matchLine.lotNumber = lotNumber;
      if (batchNumber) matchLine.batchNumber = batchNumber;
      if (expiryDate) matchLine.expiryDate = new Date(expiryDate);
      const afterQty = matchLine.received_qty;

      totalReceivedInSession += qtyNum;

      // 2. Determine QC Hold vs Available Inventory
      const isQcRequired = Boolean(matchLine.qcRequired);
      const lotToSave = lotNumber || matchLine.lotNumber || 'DEFAULT-LOT';
      const batchToSave = batchNumber || matchLine.batchNumber || '';
      
      const itemOwner = asn.owner || 'Default Owner';
      const itemOwnerType = asn.ownerType; // MUST exist because validation guarantees it for new ASNs

      if (isQcRequired) {
        // Move into Quarantine Inventory using Atomic $inc Row Lock
        await InventoryBalance.findOneAndUpdate(
          { company: req.user.company, warehouse, sku, owner: itemOwner, ownerType: itemOwnerType, lotNumber: lotToSave, bin: receivingBin },
          { 
            $inc: { qtyQuarantine: qtyNum },
            $set: { zone: receivingZone, aisle: 'A-1', rack: 'R-1', batchNumber: batchToSave, expiryDate: expiryDate ? new Date(expiryDate) : undefined }
          },
          { upsert: true, new: true, session }
        );

        await QuarantineInventory.create([{
          quarantineId: 'QC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          asnId: asn.asnId || asn.asnNumber,
          asnNumber: asn.asnId || asn.asnNumber,
          sku,
          productName: matchLine.name,
          warehouse,
          bin: receivingBin,
          qty: qtyNum,
          lotNumber: lotToSave,
          batchNumber: batchToSave,
          owner: itemOwner,
          ownerType: itemOwnerType,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          status: 'pending_qc',
          user: operator,
          company: req.user.company
        }], { session });

        await InventoryTransaction.create([{
          transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          type: 'QUARANTINE_HOLD',
          sku,
          warehouse,
          zone: receivingZone,
          bin: receivingBin,
          qty: qtyNum,
          lotNumber: lotToSave,
          batchNumber: batchToSave,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          asnNumber: asn.asnId || asn.asnNumber,
          owner: itemOwner,
          ownerType: itemOwnerType,
          user: operator,
          company: req.user.company
        }], { session });

        // Trigger Notification
        Notification.create([{
          company: req.user.company,
          kind: 'warning',
          title: 'QC Check Required',
          body: `${qtyNum} units of ${sku} placed on Quarantine Hold for ASN ${asn.asnId}.`,
        }]).catch(() => {});

        await logActivity(req, 'QC_HOLD', 'ASN', `Placed ${qtyNum} units of ${sku} on Quarantine Hold (ASN ${asn.asnId})`, session);

      } else {
        // Immediate Available Inventory Update & Putaway queueing using Atomic $inc Row Lock
        await InventoryBalance.findOneAndUpdate(
          { company: req.user.company, warehouse, sku, owner: itemOwner, ownerType: itemOwnerType, lotNumber: lotToSave, bin: receivingBin },
          { 
            $inc: { qtyAwaitingPutaway: qtyNum },
            $set: { zone: receivingZone, aisle: 'A-1', rack: 'R-1', batchNumber: batchToSave, expiryDate: expiryDate ? new Date(expiryDate) : undefined }
          },
          { upsert: true, new: true, session }
        );

        // Product.qty_available is NO LONGER incremented here (Phase 6 Invariant).
        // It will be incremented ONLY when the PutawayTask completes and stock enters qtyAvailable.

        await InventoryTransaction.create([{
          transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          type: 'RECEIVING',
          sku,
          owner: itemOwner,
          ownerType: itemOwnerType,
          warehouse,
          zone: receivingZone,
          bin: receivingBin,
          qty: qtyNum,
          lotNumber: lotToSave,
          batchNumber: batchToSave,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          asnNumber: asn.asnId || asn.asnNumber,
          user: operator,
          company: req.user.company
        }], { session });

        // RF-P01: Propose destination location via putaway engine, with staging fallback.
        // If the engine cannot find a valid location (proposedBin: null),
        // resolveStagingFallback finds a configured STAGING-type location.
        // If no staging location exists, the transaction aborts with a clear 422 error.
        const proposed = await putawayEngine.evaluatePutawayLocation({
          companyId: req.user.company,
          warehouse,
          sku,
          owner: itemOwner,
          qty: qtyNum,
          lotNumber: lotToSave
        });

        let resolvedDestinationBin = proposed.proposedBin;
        if (!resolvedDestinationBin) {
          try {
            resolvedDestinationBin = await resolveStagingFallback(req.user.company, warehouse);
          } catch (stagingErr) {
            await session.abortTransaction();
            session.endSession();
            return res.status(422).json({
              message: `RF-P01: ${stagingErr.message}`,
              sku,
              warehouse
            });
          }
        }

        const putawayId = await nextPutawayNumber(req.user.company, session);
        await PutawayTask.create([{
          taskId: putawayId,
          asnId: asn.asnId || asn.asnNumber,
          asnNumber: asn.asnId || asn.asnNumber,
          supplier: asn.supplier,
          owner: itemOwner,
          ownerType: itemOwnerType,
          sku,
          productName: matchLine.name,
          warehouse,
          qty: qtyNum,
          lotNumber: lotToSave,
          batchNumber: batchToSave,
          fromLocation: receivingDockName, // C-01 FIX: Use actual receiving dock from ASN, not generic staging
          toLocation: resolvedDestinationBin,
          destinationBin: resolvedDestinationBin,
          priority: 'normal',
          status: 'pending',
          createdBy: operator,
          company: req.user.company
        }], { session });

        await logActivity(req, 'INVENTORY_UPDATE', 'ASN', `Received SKU ${sku} (+${qtyNum} units, Owner: ${itemOwner}). Generated Putaway Task ${putawayId} to ${resolvedDestinationBin}`, session);
      }

      // 3. Record Receiving History
      await ReceivingHistory.create([{
        historyId: 'HIST-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
        asnId: asn.asnId || asn.asnNumber,
        asnNumber: asn.asnId || asn.asnNumber,
        sku,
        productName: matchLine.name,
        qtyReceived: qtyNum,
        beforeQty,
        afterQty,
        warehouse,
        receivingDock: receivingDockName, // C-01 FIX: Use actual receiving dock consistently
        operator,
        timestamp: new Date(),
        lotNumber: lotToSave,
        batchNumber: batchToSave,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        qcRequired: isQcRequired,
        company: req.user.company
      }], { session });

      // 4. Handle Damaged Qty Discrepancy
      const dmgNum = Number(damagedQty);
      if (dmgNum > 0) {
        hasDiscrepancyInSession = true;
        await Discrepancy.create([{
          discrepancyId: 'DISC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
          asnId: asn.asnId || asn.asnNumber,
          asnNumber: asn.asnId || asn.asnNumber,
          sku,
          type: 'damaged',
          expectedQty: expected,
          receivedQty: qtyNum,
          damagedQty: dmgNum,
          difference: dmgNum,
          notes: `${dmgNum} damaged units reported for SKU ${sku}`,
          user: operator,
          company: req.user.company
        }], { session });

        Notification.create([{
          company: req.user.company,
          kind: 'alert',
          title: 'Damaged Goods Reported',
          body: `${dmgNum} damaged units reported for SKU ${sku} on ASN ${asn.asnId}.`,
        }]).catch(() => {});
      }
    }

    // 5. AUTOMATIC DISCREPANCY & INCIDENT DETECTION & STATUS TRANSITION
    for (const item of asn.items) {
      const exp = Number(item.expected_qty) || 0;
      const rec = Number(item.received_qty) || 0;

      if (rec > exp) {
        hasDiscrepancyInSession = true;
        const diff = rec - exp;
        const existingDisc = await Discrepancy.findOne({ asnId: asn.asnId || asn.asnNumber, sku: item.sku, type: 'over_receiving', company: req.user.company }).session(session);
        if (!existingDisc) {
          const discId = 'DISC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
          const incId = 'INC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
          await Discrepancy.create([{
            discrepancyId: discId,
            asnId: asn.asnId || asn.asnNumber,
            asnNumber: asn.asnId || asn.asnNumber,
            sku: item.sku,
            type: 'over_receiving',
            expectedQty: exp,
            receivedQty: rec,
            difference: diff,
            notes: `Over receiving of +${diff} units for SKU ${item.sku}`,
            user: operator,
            company: req.user.company
          }], { session });

          await Incident.create([{
            incidentId: incId,
            type: 'Discrepancy',
            sku: item.sku,
            location: asn.receivingDock || 'Dock 1',
            reported_by: operator,
            status: 'open',
            description: `Over receiving of +${diff} units for SKU ${item.sku} on ASN ${asn.asnId}`,
            company: req.user.company
          }], { session });

          await logActivity(req, 'DISCREPANCY_DETECTED', 'ASN', `Over-receiving detected for SKU ${item.sku} (+${diff} units). Discrepancy ${discId} & Incident ${incId} created.`, session);
        }
      } else if (rec < exp && (req.body.isFinalize || rec > 0)) {
        // Track shortage if finalize requested or partial receiving recorded
        const diff = exp - rec;
        const existingDisc = await Discrepancy.findOne({ asnId: asn.asnId || asn.asnNumber, sku: item.sku, type: 'under_receiving', company: req.user.company }).session(session);
        if (!existingDisc) {
          hasDiscrepancyInSession = true;
          const discId = 'DISC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
          const incId = 'INC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
          await Discrepancy.create([{
            discrepancyId: discId,
            asnId: asn.asnId || asn.asnNumber,
            asnNumber: asn.asnId || asn.asnNumber,
            sku: item.sku,
            type: 'under_receiving',
            expectedQty: exp,
            receivedQty: rec,
            difference: diff,
            notes: `Shortage of ${diff} units for SKU ${item.sku}`,
            user: operator,
            company: req.user.company
          }], { session });

          await Incident.create([{
            incidentId: incId,
            type: 'Discrepancy',
            sku: item.sku,
            location: asn.receivingDock || 'Dock 1',
            reported_by: operator,
            status: 'open',
            description: `Shortage of ${diff} units for SKU ${item.sku} on ASN ${asn.asnId}`,
            company: req.user.company
          }], { session });

          await logActivity(req, 'DISCREPANCY_DETECTED', 'ASN', `Shortage detected for SKU ${item.sku} (${diff} units missing). Discrepancy ${discId} & Incident ${incId} created.`, session);
        }
      }
    }

    const totalExpectedUnits = asn.items.reduce((s, i) => s + (Number(i.expected_qty) || 0), 0);
    const totalReceivedUnits = asn.items.reduce((s, i) => s + (Number(i.received_qty) || 0), 0);

    const existingDiscrepanciesCount = await Discrepancy.countDocuments({
      asnId: asn.asnId || asn.asnNumber,
      company: req.user.company
    }).session(session);

    const oldStatus = asn.status;
    let newStatus = oldStatus;

    if (totalReceivedUnits >= totalExpectedUnits || req.body.isFinalize) {
      if (existingDiscrepanciesCount > 0 || hasDiscrepancyInSession) {
        newStatus = 'completed_with_discrepancies';
      } else {
        newStatus = 'completed';
      }
    } else if (totalReceivedUnits > 0) {
      newStatus = 'in_progress';
    }

    if (newStatus !== oldStatus) {
      asn.status = newStatus;
      await logActivity(req, 'STATUS_CHANGE', 'ASN', `ASN ${asn.asnId} status automatically updated from '${oldStatus}' to '${newStatus}'`, session);

      if (newStatus === 'completed' || newStatus === 'completed_with_discrepancies') {
        Notification.create([{
          company: req.user.company,
          kind: 'success',
          title: 'ASN Receiving Completed',
          body: `ASN ${asn.asnId} (${asn.supplier}) has completed receiving (${totalReceivedUnits}/${totalExpectedUnits} units).`,
        }]).catch(() => {});

        // Automatically Generate Inbound Delivery Note (DN-2026-000001)
        await generateInboundDeliveryNote(asn, req.user.company, operator, session);
      }
    }

    asn.markModified('items');
    const updatedAsn = await asn.save({ session });

    // Commit Transaction (All Writes Succeed Together)
    await session.commitTransaction();
    session.endSession();

    const responsePayload = {
      message: `Successfully received ${totalReceivedInSession} units against ASN ${asn.asnId}.`,
      asn: updatedAsn,
      receivedUnitsInSession: totalReceivedInSession,
      status: updatedAsn.status
    };

    res.json(responsePayload);

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// UPDATE ASN
router.put('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const isObjId = mongoose.Types.ObjectId.isValid(req.params.id);
    const existing = await ASN.findOne({
      $or: [
        ...(isObjId ? [{ _id: req.params.id }] : []),
        { asnId: req.params.id },
        { asnNumber: req.params.id }
      ],
      company: req.user.company,
      isDeleted: { $ne: true }
    });
    if (!existing) return res.status(404).json({ message: 'ASN not found' });

    // Explicit Version / Optimistic Concurrency Conflict Check
    if (req.body.__v !== undefined && existing.__v !== undefined && req.body.__v !== existing.__v) {
      return res.status(409).json({
        message: 'Conflict Detected: This ASN has been modified by another warehouse manager. Please refresh and re-apply your edits.',
        currentVersion: existing.__v,
        submittedVersion: req.body.__v
      });
    }

    // H-03: ASN Product Autofill
    if (req.body.items) {
      await autofillAsnProducts(req.body.items, req.user.company);
    }

    const validationErrors = validateAsnPayload(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ message: validationErrors.join(' ') });
    }

    // G-01: Central Client/Owner Master Enforcement
    const ownerToCheck = req.body.owner !== undefined ? req.body.owner : existing.owner;
    const typeToCheck = req.body.ownerType !== undefined ? req.body.ownerType : existing.ownerType;
    const ownerError = await validateOwnerMaster(ownerToCheck, typeToCheck, req.user.company);
    if (ownerError) {
      return res.status(400).json({ message: ownerError });
    }

    const allowed = { ...req.body };
    delete allowed.asnId;     // immutable
    delete allowed.asnNumber; // immutable
    delete allowed.company;   // immutable

    Object.assign(existing, allowed);

    try {
      const updated = await existing.save();
      await logActivity(req, 'UPDATE', 'ASN', `Updated ASN ${updated.asnId} (${updated.supplier})`);
      res.json(updated);
    } catch (saveErr) {
      if (saveErr.name === 'VersionError' || saveErr.name === 'ParallelSaveError') {
        return res.status(409).json({
          message: 'Conflict Detected: Concurrent update conflict. Another user saved changes to this document simultaneously.'
        });
      }
      throw saveErr;
    }
  } catch (err) { next(err); }
});

// PATCH Status (State Machine Enforced)
router.patch('/:id/status', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const { status } = req.body;
    const allowed = ['pending', 'in_progress', 'completed', 'completed_with_discrepancies', 'cancelled'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }

    const item = await ASN.findOne({ _id: req.params.id, company: req.user.company, isDeleted: { $ne: true } });
    if (!item) return res.status(404).json({ message: 'ASN not found' });

    // Validate state machine transition
    if (!isValidStatusTransition(item.status, status, req.user.role)) {
      return res.status(400).json({
        message: `Invalid state transition: Cannot change status from '${item.status}' directly to '${status}'.`
      });
    }

    item.status = status;
    const updated = await item.save();

    await logActivity(req, 'STATUS_CHANGE', 'ASN', `Changed ASN ${updated.asnId} status from '${item.status}' to '${status}'`);

    res.json(updated);
  } catch (err) { next(err); }
});

// SOFT DELETE ASN (Preserves Enterprise Audit Trail & History)
router.delete('/:id', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const item = await ASN.findOne({ _id: req.params.id, company: req.user.company, isDeleted: { $ne: true } });
    if (!item) return res.status(404).json({ message: 'ASN not found' });

    item.isDeleted = true;
    item.deletedAt = new Date();
    item.status = 'cancelled';
    await item.save();

    await logActivity(req, 'DELETE', 'ASN', `Soft deleted & cancelled ASN ${item.asnId} (${item.supplier})`);

    res.json({ message: 'ASN cancelled and archived successfully (Soft Delete)' });
  } catch (err) { next(err); }
});

// POST /api/v1/receiving/reject-barcode — Create Incident on Barcode Rejection
router.post('/reject-barcode', requireOpsRole, async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const { asnId, scannedBarcode, reason } = req.body;
    const incidentId = 'INC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);

    const incident = await Incident.create({
      incidentId,
      company: req.user.company,
      asnId: asnId || 'N/A',
      scannedBarcode: scannedBarcode || 'UNKNOWN',
      module: 'Receiving',
      type: 'Rejected Barcode Scan',
      reason: reason || 'Unexpected barcode scan rejected',
      status: 'open',
      createdAt: new Date()
    });

    await logActivity(req, 'BARCODE_REJECTED', 'RECEIVING', `Rejected barcode '${scannedBarcode}' for ASN '${asnId}'. Incident #${incidentId} logged.`);

    res.json({
      success: true,
      message: `Barcode scan rejected. Incident #${incidentId} created. Zero inventory incremented.`,
      incident
    });
  } catch (err) { next(err); }
});

export default router;
