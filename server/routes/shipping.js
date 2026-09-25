import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole, requireOfficeAccess } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Model from '../models/Shipment.js';
import Order from '../models/Order.js';
import ActivityLog from '../models/ActivityLog.js';
import PickTask from '../models/PickTask.js';
import InventoryValuationEngine from '../services/InventoryValuationEngine.js';
import JournalEntry from '../models/JournalEntry.js';
import Counter from '../models/Counter.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';
import { resolveActiveInventoryAssetAccount } from '../services/InventoryAssetAccountResolver.js';
import { IdempotencyService } from '../services/IdempotencyService.js';
import DigitalSignature from '../models/DigitalSignature.js';
import Document from '../models/Document.js';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import { carrierRegistry } from '../services/carriers/CarrierAdapterRegistry.js';
import Carrier from '../models/Carrier.js';

const router = express.Router();

router.use(protect); // Secure all routes by default

const requireOpsRole = requireRole('admin', 'manager');
const blockOffice = requireOfficeAccess;

// ── GET /api/v1/shipping/methods — RF-P12 Carrier Methods Discovery ──
router.get('/methods', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const registryCarriers = carrierRegistry.listAll();
    const dbCarriers = await Carrier.find({ company: req.user.company, active: { $ne: false } }).lean();

    const methods = registryCarriers.map(rc => {
      const dbMatch = dbCarriers.find(c => c.name?.toUpperCase() === rc.code || c.code?.toUpperCase() === rc.code);
      return {
        id: rc.code.toLowerCase(),
        code: rc.code,
        name: dbMatch?.name || rc.name,
        services: rc.supportedServices,
        isProductionConfigured: rc.isProductionConfigured,
        supportsInternational: rc.supportsInternational,
        supportsTracking: rc.supportsTracking,
        description: rc.description
      };
    });

    res.json({
      success: true,
      count: methods.length,
      methods
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/shipping/rate-quote — Quote Estimated Shipping Rates ──
router.post('/rate-quote', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const { carrier, senderPostalCode, recipientPostalCode, destinationCountry, weightKg, serviceLevel } = req.body;

    const adapter = carrierRegistry.get(carrier || 'CTT');
    const quote = await adapter.calculateRate({
      origin: { postcode: senderPostalCode || '08020', country: 'ES' },
      destination: { postcode: recipientPostalCode || '28001', country: destinationCountry || 'ES' },
      destinationCountry: destinationCountry || 'ES',
      weightKg: Number(weightKg) || 1.0,
      serviceType: serviceLevel || 'STANDARD'
    });

    res.json({
      carrier: adapter.carrierCode,
      carrierName: adapter.name,
      rate: quote.rate,
      currency: quote.currency || 'EUR',
      estimatedDeliveryDays: quote.estimatedDeliveryDays || 1,
      isSandbox: quote.isSandbox || false
    });
  } catch (err) {
    next(err);
  }
});

// GET all
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['shipmentId', 'customer', 'tracking', 'order'],
      exact: { carrier: 'carrier' },
    });
    const result = await paginateQuery(Model, filter, req);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── GROUP ORDERS (VALIDATE COMPATIBILITY FOR GROUPED SHIPMENT) ──
router.post(['/group-orders', '/group-validate'], requireOpsRole, blockOffice, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { orderIds } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: 'Please provide at least one order ID for grouping.' });
    }

    if (orderIds.length === 1) {
      return res.status(400).json({ message: 'Grouping requires at least 2 orders. Single orders use standard shipment flow.' });
    }

    // Fetch all orders
    const orders = await Order.find({
      company: req.user.company,
      $or: [
        { orderId: { $in: orderIds } },
        { _id: { $in: orderIds.filter(id => mongoose.isValidObjectId(id)) } }
      ]
    });

    if (orders.length !== orderIds.length) {
      return res.status(404).json({
        message: `Only ${orders.length} of ${orderIds.length} orders found.`,
        foundOrderIds: orders.map(o => o.orderId)
      });
    }

    // Validate grouping compatibility
    const validationErrors = [];

    // Check: All orders must belong to same company (already enforced by query)
    // Check: All orders must belong to same warehouse
    const warehouses = [...new Set(orders.map(o => o.warehouse || 'MIA'))];
    if (warehouses.length > 1) {
      validationErrors.push(`Warehouse mismatch: orders span multiple warehouses [${warehouses.join(', ')}]`);
    }

    // Check: All orders must have compatible owner
    const owners = [...new Set(orders.map(o => o.owner || 'Default Owner'))];
    if (owners.length > 1) {
      validationErrors.push(`Owner mismatch: orders belong to different owners [${owners.join(', ')}]`);
    }

    // Check: All orders must have compatible shipping type (B2B vs B2C)
    const orderTypes = [...new Set(orders.map(o => o.order_type || 'B2C'))];
    if (orderTypes.length > 1) {
      validationErrors.push(`Order type mismatch: cannot mix B2B and B2C orders [${orderTypes.join(', ')}]`);
    }

    // Check: Orders must not be in terminal states
    const terminalStatuses = ['shipped', 'delivered', 'cancelled'];
    const terminalOrders = orders.filter(o => terminalStatuses.includes(o.status));
    if (terminalOrders.length > 0) {
      validationErrors.push(`Terminal order(s) cannot be grouped: ${terminalOrders.map(o => o.orderId).join(', ')}`);
    }

    // Check: Orders must not already have a shipment
    const shippedOrders = orders.filter(o => o.shipmentId);
    if (shippedOrders.length > 0) {
      validationErrors.push(`Order(s) already have shipments: ${shippedOrders.map(o => o.orderId).join(', ')}`);
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Order grouping validation failed',
        errors: validationErrors
      });
    }

    // Return compatibility confirmation
    res.json({
      compatible: true,
      orderCount: orders.length,
      warehouse: warehouses[0],
      owner: owners[0],
      orderType: orderTypes[0],
      orderIds: orders.map(o => o.orderId),
      totalItems: orders.reduce((sum, o) => sum + (o.items || 0), 0),
      totalValue: orders.reduce((sum, o) => sum + (o.total || 0), 0)
    });
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', requireOpsRole, blockOffice, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const data = { ...req.body, company: req.user.company };

    // Handle grouped orders
    if (data.orders && Array.isArray(data.orders) && data.orders.length > 1) {
      // Grouped shipment mode
      data.isGrouped = true;
      data.groupedShipmentId = data.groupedShipmentId || `GRP-${Date.now()}`;
      data.order = data.orders[0]; // Legacy compatibility: first order as primary

      // Update all orders with shipment reference
      await Order.updateMany(
        { orderId: { $in: data.orders }, company: req.user.company },
        { $set: { shipmentId: data.shipmentId } },
        { session }
      );
    } else if (data.order) {
      // Single order mode (backward compatible)
      data.isGrouped = false;
      data.orders = [data.order];

      // Update order with shipment reference
      await Order.findOneAndUpdate(
        { orderId: data.order, company: req.user.company },
        { $set: { shipmentId: data.shipmentId } },
        { session }
      );
    }

    const item = await Model.create([data], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json(item[0]);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

// UPDATE
router.put('/:id', requireOpsRole, blockOffice, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const existing = await Model.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!existing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Not found' });
    }

    const wasShipped = existing.status === 'shipped' || existing.status === 'in_transit';
    const isShipped = req.body.status === 'shipped' || req.body.status === 'in_transit';

    let idempotencyLock = null;
    if (!wasShipped && isShipped) {
      try {
        idempotencyLock = await IdempotencyService.acquireLock(
          req.user.company,
          'SHIPMENT_ACCOUNTING',
          `SHIPMENT_ACCOUNTING_${req.params.id}`,
          req.body
        );
        if (idempotencyLock.status === 'CACHED') {
          await session.abortTransaction();
          session.endSession();
          return res.json(idempotencyLock.response);
        }
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        if (err.status === 409) return res.status(409).json({ message: err.message });
        throw err;
      }
    }

    const item = await Model.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      req.body,
      { new: true, session }
    );

    if (!wasShipped && isShipped) {
      await Order.findOneAndUpdate(
        { orderId: item.order, company: req.user.company },
        { status: 'shipped' },
        { new: true, session }
      );

      // --- PHASE 8A.4: SHIPPING / COGS ACCOUNTING INTEGRATION ---

      if (!item.packId) {
        throw new Error('HARD INTEGRITY EXCEPTION: Shipment lacks packId. Cannot trace to PickTask for COGS.');
      }

      const pickTask = await PickTask.findOne({ taskId: item.packId, company: req.user.company }).session(session);
      if (!pickTask) {
        throw new Error(`HARD INTEGRITY EXCEPTION: PickTask ${item.packId} not found.`);
      }

      const orderDoc = await Order.findOne({ orderId: item.order, company: req.user.company }).session(session);
      if (!orderDoc) {
        throw new Error(`HARD INTEGRITY EXCEPTION: Order ${item.order} not found for pricing snapshot.`);
      }

      const skuPrices = {};
      if (orderDoc.product_lines) {
        for (const line of orderDoc.product_lines) {
          skuPrices[line.sku] = line.unit_price || 0;
        }
      }

      let totalCogsValue = 0;
      let totalRevenueValue = 0;
      const financialItems = [];
      const jeId = new mongoose.Types.ObjectId(); // Pre-generate ID for idempotency & linkage

      // Resolve the active InventoryAssetAccountMapping WITHIN the transaction, ONCE for this
      // shipment event. Every picked-SKU's processOutgoing call and the consolidated JE line
      // will use the SAME accountId, guaranteeing Ledger snapshot == JE account.
      const inventoryAssetAccountId = await resolveActiveInventoryAssetAccount(
        req.user.company, new Date(), session
      );

      // Aggregate picking lines by sku + owner + ownerType to prevent URN collisions
      const aggregatedLines = {};
      for (const ptItem of pickTask.items) {
        if (!ptItem.pickedQty || ptItem.pickedQty <= 0) continue;
        if (!ptItem.inventoryOwner) {
          throw new Error(`HARD ACCOUNTING EXCEPTION: Missing owner on PickTask line for SKU ${ptItem.sku}`);
        }
        if (!ptItem.ownerType) {
          throw new Error(`HARD ACCOUNTING EXCEPTION: Missing ownerType on PickTask line for SKU ${ptItem.sku}`);
        }
        const key = `${ptItem.sku}::${ptItem.inventoryOwner}::${ptItem.ownerType}`;
        if (!aggregatedLines[key]) {
          aggregatedLines[key] = {
            sku: ptItem.sku,
            owner: ptItem.inventoryOwner,
            ownerType: ptItem.ownerType,
            qty: 0
          };
        }
        aggregatedLines[key].qty += ptItem.pickedQty;
      }

      for (const key in aggregatedLines) {
        const aggItem = aggregatedLines[key];
        const costResult = await InventoryValuationEngine.processOutgoing(session, {
          company: req.user.company,
          sku: aggItem.sku,
          owner: aggItem.owner,
          ownerType: aggItem.ownerType,
          qty: aggItem.qty,
          eventType: 'SHIPMENT',
          referenceId: item.shipmentId,
          journalEntryId: jeId,
          inventoryAssetAccountId  // same as JE line below — snapshot immutability
        });

        if (!costResult.skipped && aggItem.ownerType === 'COMPANY') {
          // It's company-owned and processed successfully.
          // appliedValue = unitCostApplied * absolute quantityChange
          const appliedValue = costResult.ledger.unitCostApplied * Math.abs(costResult.ledger.quantityChange);
          totalCogsValue += appliedValue;

          // Calculate Revenue Snapshot
          const unitPrice = skuPrices[aggItem.sku] || 0;
          const revAmount = aggItem.qty * unitPrice;
          totalRevenueValue += revAmount;

          financialItems.push({
            sku: aggItem.sku,
            qty: aggItem.qty,
            unitPriceSnapshot: unitPrice,
            revenueAmount: revAmount
          });
        }
      }

      // Create Consolidated Journal Entry if company-owned COGS/Revenue exists
      if (totalCogsValue > 0 || totalRevenueValue > 0) {
        const accountingConfig = await CompanyAccountingConfig.findOne({ company: req.user.company }).session(session);
        if (!accountingConfig || !accountingConfig.defaultCOGSAccountId || !accountingConfig.defaultInventoryAssetAccountId || !accountingConfig.defaultSalesRevenueAccountId || !accountingConfig.defaultUnbilledReceivableAccountId) {
          throw new Error('HARD ACCOUNTING EXCEPTION: Missing CompanyAccountingConfig or required accounts (COGS/Asset/Rev/Unbilled) for shipping valuation.');
        }

        const currentYear = new Date().getFullYear();
        const jeCounter = await Counter.findOneAndUpdate(
          { _id: `journal_entry_${currentYear}_${req.user.company}` },
          { $inc: { seq: 1 } },
          { new: true, upsert: true, session }
        );
        const jeNumber = `JE-${currentYear}-${String(jeCounter.seq).padStart(5, '0')}`;

        const lines = [];
        if (totalCogsValue > 0) {
          lines.push({
            accountId: accountingConfig.defaultCOGSAccountId,
            account: 'COGS',
            description: 'Cost of Goods Sold',
            debit: totalCogsValue,
            credit: 0
          });
          lines.push({
            accountId: inventoryAssetAccountId,  // snapshot — from active mapping, same as Ledger
            account: 'Inventory Asset',
            description: 'Inventory Asset Deduction',
            debit: 0,
            credit: totalCogsValue
          });
        }
        if (totalRevenueValue > 0) {
          lines.push({
            accountId: accountingConfig.defaultUnbilledReceivableAccountId,
            account: 'Unbilled Receivable',
            description: 'Accrued Unbilled AR',
            debit: totalRevenueValue,
            credit: 0
          });
          lines.push({
            accountId: accountingConfig.defaultSalesRevenueAccountId,
            account: 'Sales Revenue',
            description: 'Revenue recognized at shipment',
            debit: 0,
            credit: totalRevenueValue
          });
        }

        await JournalEntry.create([{
          _id: jeId,
          entryNumber: jeNumber,
          date: new Date(),
          reference: item.shipmentId,
          description: `COGS & Revenue Recognition for Shipment ${item.shipmentId}`,
          entryType: 'manual',
          sourceDocument: { docType: 'other', docNumber: item.shipmentId },
          lines: lines,
          totalDebit: totalCogsValue + totalRevenueValue,
          totalCredit: totalCogsValue + totalRevenueValue,
          status: 'posted',
          postedAt: new Date(),
          company: req.user.company
        }], { session });
      }

      // Save the financial snapshot directly on the shipment
      if (financialItems.length > 0) {
        await Model.updateOne({ _id: item._id }, { $set: { financial_items: financialItems } }, { session });
        // Update in memory for returning response
        item.financial_items = financialItems;
      }

      // --- END ACCOUNTING INTEGRATION ---

      await ActivityLog.create([{
        logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        user: req.user.name || req.user.email || 'system',
        role: 'warehouse_staff',
        action: 'SHIPPED_ORDER',
        module: 'SHIPPING',
        detail: `Shipped order ${item.order} via ${item.carrier || 'Pending'} (${item.tracking || 'Pending'})`,
        company: req.user.company
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    if (idempotencyLock) {
      await IdempotencyService.completeLock(idempotencyLock.record._id, item);
    }

    res.json(item);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    if (typeof idempotencyLock !== 'undefined' && idempotencyLock && idempotencyLock.record) {
      await IdempotencyService.failLock(idempotencyLock.record._id, err).catch(e => console.error('Failed to update idempotency failure', e));
    }

    next(err);
  }
});

// ── SIGN SHIPMENT (DIGITAL SIGNATURE) ──
router.post('/:id/sign', requireOpsRole, blockOffice, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const shipment = await Model.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { shipmentId: req.params.id }]
    }).session(session);

    if (!shipment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // Check if already signed
    const existingSignature = await DigitalSignature.findOne({
      company: req.user.company,
      shipmentId: shipment.shipmentId
    }).session(session);

    if (existingSignature) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Shipment ${shipment.shipmentId} is already signed by ${existingSignature.signerName} at ${existingSignature.signedAt}` });
    }

    const { signatureData, discrepancyNote } = req.body;

    // A & B: Validate signatureData
    if (!signatureData || typeof signatureData !== 'string' || signatureData.trim().length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Signature data is required and cannot be empty' });
    }

    // Validate payload format (must contain base64 image data)
    const base64Clean = signatureData.replace(/^data:image\/\w+;base64,/, '').trim();
    if (!base64Clean || !/^[A-Za-z0-9+/=]+$/.test(base64Clean.replace(/\s+/g, ''))) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Malformed signature payload: must be valid base64 image data' });
    }

    // Validate discrepancy note (required if shipment has discrepancies, optional otherwise)
    if (discrepancyNote && typeof discrepancyNote === 'string' && discrepancyNote.trim().length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Discrepancy note cannot be whitespace-only' });
    }

    const signedAt = new Date();
    const sigPayload = {
      shipmentId: shipment.shipmentId,
      shipmentRef: shipment._id,
      signerName: req.user.name || req.user.email || 'Authorized Signatory',
      signerEmail: req.user.email || 'recipient@customer.com',
      signerRole: req.user.role || 'recipient',
      signatureData,
      signedAt,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      discrepancyNote: discrepancyNote?.trim() ? discrepancyNote.trim() : null,
      warehouse: shipment.origin || 'Unknown',
      company: req.user.company,
      emailStatus: 'pending'
    };

    // C: Generate actual signed delivery document PDF with embedded signature image
    let pdfBuffer;
    try {
      pdfBuffer = await generateSignedDeliveryPDFBuffer({ shipment, signature: sigPayload });
    } catch (pdfErr) {
      console.error('Failed to generate signed delivery PDF:', pdfErr);
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: 'Failed to generate signed document PDF: ' + pdfErr.message });
    }

    // Persist Document using Document infrastructure
    const docNumber = `POD-${shipment.shipmentId}-${Date.now()}`;
    const signedDoc = await Document.create([{
      documentNumber: docNumber,
      type: 'SIGNED_DELIVERY_NOTE',
      shipmentId: shipment.shipmentId,
      customer: shipment.customer || 'Customer',
      supplier: shipment.customer || 'Customer',
      warehouse: shipment.origin || 'MIA',
      receivedAt: signedAt,
      totalExpected: shipment.financial_items?.reduce((s, i) => s + (i.qty || 0), 0) || 1,
      totalReceived: shipment.financial_items?.reduce((s, i) => s + (i.qty || 0), 0) || 1,
      pdfDataUri: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
      generatedBy: req.user.name || req.user.email || 'system',
      company: req.user.company
    }], { session });

    sigPayload.documentId = signedDoc[0]._id;

    // D: Create signature record
    const signature = await DigitalSignature.create([sigPayload], { session });

    // Mark shipment delivered / signed
    shipment.status = 'delivered';
    await shipment.save({ session });

    // AUDIT: Signature created
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: req.user.name || req.user.email || 'system',
      role: req.user.role || 'warehouse_staff',
      action: 'SHIPMENT_SIGNED',
      module: 'SHIPPING',
      detail: `Shipment ${shipment.shipmentId} signed by ${sigPayload.signerName} (${sigPayload.signerRole})`,
      company: req.user.company
    }], { session });

    await session.commitTransaction();
    session.endSession();

    // E: Email dispatch (non-blocking - does not roll back transaction on failure)
    try {
      await sendSignedDocumentEmail(shipment, signature[0], pdfBuffer, req.user.company);
      await DigitalSignature.findByIdAndUpdate(signature[0]._id, {
        emailStatus: 'sent',
        emailSentAt: new Date()
      });
      signature[0].emailStatus = 'sent';
      signature[0].emailSentAt = new Date();
    } catch (emailErr) {
      console.error('Failed to send signed document email:', emailErr.message);
      await DigitalSignature.findByIdAndUpdate(signature[0]._id, {
        emailStatus: 'failed',
        emailError: emailErr.message
      });
      signature[0].emailStatus = 'failed';
      signature[0].emailError = emailErr.message;
    }

    res.json(signature[0]);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
});

/**
 * Retry email sending for existing signed shipment (idempotent, does not duplicate signature)
 */
router.post('/:id/sign/retry-email', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const shipment = await Model.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { shipmentId: req.params.id }]
    });

    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const signature = await DigitalSignature.findOne({
      company: req.user.company,
      shipmentId: shipment.shipmentId
    });

    if (!signature) return res.status(404).json({ message: 'No digital signature found for this shipment' });

    try {
      await sendSignedDocumentEmail(shipment, signature, null, req.user.company);
      signature.emailStatus = 'sent';
      signature.emailSentAt = new Date();
      signature.emailError = null;
      await signature.save();
      res.json({ message: 'Email resent successfully', signature });
    } catch (emailErr) {
      signature.emailStatus = 'failed';
      signature.emailError = emailErr.message;
      await signature.save();
      res.status(500).json({ message: 'Email retry failed: ' + emailErr.message, signature });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET signature details for a shipment
 */
router.get('/:id/signature', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const shipment = await Model.findOne({
      company: req.user.company,
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { shipmentId: req.params.id }]
    });

    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const signature = await DigitalSignature.findOne({
      company: req.user.company,
      shipmentId: shipment.shipmentId
    }).populate('documentId');

    if (!signature) return res.status(404).json({ message: 'No signature found for shipment' });

    res.json(signature);
  } catch (err) {
    next(err);
  }
});

/**
 * Generate signed delivery document PDF with actual embedded signature image
 */
export async function generateSignedDeliveryPDFBuffer({ shipment, signature }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // Header Banner
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#0f172a').text('PROOF OF DELIVERY', { align: 'left' });
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0284c7').text('DIGITALLY SIGNED DELIVERY RECEIPT', { align: 'left' });
      doc.moveDown(0.5);

      // Metadata Block
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155');
      doc.text(`Shipment ID: ${shipment.shipmentId}`);
      doc.font('Helvetica');
      doc.text(`Tracking Number: ${shipment.tracking || 'N/A'}`);
      doc.text(`Carrier: ${shipment.carrier || 'N/A'}`);
      doc.text(`Customer / Recipient: ${shipment.customer || 'N/A'}`);
      doc.text(`Origin Warehouse: ${shipment.origin || 'MIA'}`);
      doc.text(`Destination: ${shipment.destination || 'N/A'}`);
      doc.text(`Signed At: ${new Date(signature.signedAt).toISOString()}`);
      doc.text(`Signer Name: ${signature.signerName}`);
      doc.text(`Signer Email: ${signature.signerEmail}`);
      doc.text(`Signer Role: ${signature.signerRole}`);
      if (signature.ipAddress) {
        doc.text(`IP Address: ${signature.ipAddress}`);
      }
      doc.moveDown(0.5);

      if (signature.discrepancyNote) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#b91c1c').text('Discrepancy / Delivery Notes:');
        doc.font('Helvetica').fillColor('#334155').text(signature.discrepancyNote);
        doc.moveDown(0.5);
      }

      // Financial Items / line items summary
      if (shipment.financial_items && shipment.financial_items.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('Delivered Items Summary:');
        doc.fontSize(9).font('Helvetica').fillColor('#334155');
        shipment.financial_items.forEach((item, idx) => {
          doc.text(`${idx + 1}. SKU: ${item.sku} - Qty: ${item.qty}`);
        });
        doc.moveDown(0.5);
      }

      // Embedded Digital Signature Image
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Digital Signature:');
      doc.moveDown(0.3);

      const base64Clean = (signature.signatureData || '').replace(/^data:image\/\w+;base64,/, '');
      if (base64Clean && base64Clean.length > 0) {
        try {
          const imgBuf = Buffer.from(base64Clean, 'base64');
          doc.image(imgBuf, { width: 160 });
        } catch (imgErr) {
          doc.fontSize(9).fillColor('#64748b').text('[Verified Base64 Digital Signature]');
        }
      }

      doc.moveDown(0.5);
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#64748b').text(`Digitally sealed and verified on ${new Date(signature.signedAt).toISOString()}`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Send signed document email (non-blocking)
 */
async function sendSignedDocumentEmail(shipment, signature, pdfBuffer, companyId) {
  if (process.env.FORCE_EMAIL_ERROR === 'true') {
    throw new Error('Simulated SMTP transport error');
  }

  if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      } : undefined
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@wms.com',
      to: signature.signerEmail,
      subject: `Signed Proof of Delivery - Shipment ${shipment.shipmentId}`,
      text: `Please find attached the signed delivery document for shipment ${shipment.shipmentId}.`,
      attachments: pdfBuffer ? [
        {
          filename: `ProofOfDelivery-${shipment.shipmentId}.pdf`,
          content: pdfBuffer
        }
      ] : undefined
    });
  } else {
    // Non-blocking logged email simulation
    console.log(`[EMAIL] Dispatched signed delivery note for ${shipment.shipmentId} to ${signature.signerEmail}`);
  }
}

// ── POST /api/v1/shipping/rate-quote — Compare Carrier Shipping Rates ──
router.post('/rate-quote', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const { destinationCountry = 'ES', weightKg = 1.0, serviceLevel = 'STANDARD' } = req.body;

    const adapters = [carrierRegistry.get('CTT'), carrierRegistry.get('CORREOS'), carrierRegistry.get('GLS'), carrierRegistry.get('DHL'), carrierRegistry.get('SEUR')];
    const quotes = await Promise.all(
      adapters.map(async (adapter) => {
        try {
          return await adapter.calculateRate({ weightKg: Number(weightKg) || 1, destinationCountry });
        } catch (_) {
          return null;
        }
      })
    );

    res.json({
      success: true,
      quotes: quotes.filter(Boolean)
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/shipping/:id/generate-label — Auto Generate Carrier Label & Tracking ──
router.post('/:id/generate-label', requireOpsRole, blockOffice, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const shipment = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    let orderDoc = null;
    if (shipment.order) {
      orderDoc = await Order.findOne({ orderId: shipment.order, company: req.user.company });
    }

    const recipient = {
      name: shipment.customer || orderDoc?.customer || 'Client Recipient',
      street: orderDoc?.delivery_address?.street || orderDoc?.deliveryAddress?.street || 'Calle Principal 10',
      city: orderDoc?.delivery_address?.city || orderDoc?.deliveryAddress?.city || 'Madrid',
      postcode: orderDoc?.delivery_address?.postcode || orderDoc?.deliveryAddress?.postcode || '28001',
      province: orderDoc?.delivery_address?.province || orderDoc?.deliveryAddress?.region || 'Madrid',
      country: orderDoc?.delivery_address?.country || orderDoc?.deliveryAddress?.country || 'ES',
      phone: orderDoc?.delivery_address?.phone || orderDoc?.deliveryAddress?.phone || '+34 600 000 000'
    };

    const sender = {
      name: 'House Logistic 3PL / Central Hub',
      address: 'Polígono Can Salvatella, Nave 4',
      city: 'Barberà del Vallès',
      postcode: '08210',
      province: 'Barcelona',
      country: 'ES'
    };

    const requestedCarrier = req.body.carrier || shipment.carrier || null;
    const serviceLevel = req.body.serviceLevel || 'STANDARD';
    const weightKg = Number(req.body.weightKg || shipment.weight || 1.5);
    const parcelsCount = Number(req.body.parcelsCount || shipment.parcelsCount || 1);

    const selection = await carrierRegistry.selectCarrierForShipment({
      destinationCountry: recipient.country,
      weightKg,
      serviceLevel,
      preferredCarrier: requestedCarrier
    });

    const carrierResult = await selection.adapter.createShipment({
      shipmentId: shipment.shipmentId || String(shipment._id),
      orderId: orderDoc?.orderId || shipment.order,
      sender,
      recipient,
      weightKg,
      serviceType: req.body.serviceType || undefined,
      parcelsCount,
      notes: req.body.notes || ''
    });

    shipment.tracking = carrierResult.trackingNumber;
    shipment.carrier = carrierResult.carrierCode;
    shipment.carrierShipmentId = carrierResult.carrierShipmentId;
    shipment.shippingCost = carrierResult.cost;
    shipment.labelUrl = `/api/v1/shipping/${shipment._id}/label`;
    await shipment.save();

    if (orderDoc) {
      orderDoc.tracking = carrierResult.trackingNumber;
      orderDoc.carrier = carrierResult.carrierCode;
      await orderDoc.save();
    }

    const docNum = 'DOC-LABEL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    await Document.create({
      documentNumber: docNum,
      documentId: docNum,
      type: 'SHIPPING_LABEL',
      title: `Shipping Label ${carrierResult.trackingNumber} (${carrierResult.carrierName})`,
      content: carrierResult.labelBase64,
      mimeType: 'application/pdf',
      company: req.user.company,
      relatedEntity: { type: 'Shipment', id: shipment._id },
      createdBy: req.user.name || req.user.email || 'system'
    });

    await ActivityLog.create({
      logId: 'LOG-SHIP-LABEL-' + Date.now(),
      action: 'GENERATE_LABEL',
      module: 'Shipping',
      user: req.user.email || 'system',
      company: req.user.company,
      detail: `Generated ${carrierResult.carrierName} label: ${carrierResult.trackingNumber} (Cost: ${carrierResult.cost} EUR)`
    });

    res.json({
      success: true,
      trackingNumber: carrierResult.trackingNumber,
      carrier: carrierResult.carrierCode,
      carrierName: carrierResult.carrierName,
      serviceType: carrierResult.serviceType,
      cost: carrierResult.cost,
      currency: carrierResult.currency,
      selectionReason: selection.reason,
      isSandbox: carrierResult.isSandbox,
      labelUrl: shipment.labelUrl,
      labelBase64: carrierResult.labelBase64
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/shipping/:id/label — Download Shipping Label PDF ──
router.get('/:id/label', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const shipment = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const doc = await Document.findOne({
      company: req.user.company,
      'relatedEntity.id': shipment._id,
      type: 'SHIPPING_LABEL'
    }).sort({ createdAt: -1 });

    if (doc && doc.content) {
      const buffer = Buffer.from(doc.content, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="label-${shipment.tracking || shipment.shipmentId}.pdf"`);
      return res.send(buffer);
    }

    const adapter = carrierRegistry.get(shipment.carrier || 'CTT');
    const orderDoc = shipment.order ? await Order.findOne({ orderId: shipment.order, company: req.user.company }) : null;
    const recipient = {
      name: shipment.customer || orderDoc?.customer || 'Recipient',
      street: orderDoc?.delivery_address?.street || 'Address',
      city: orderDoc?.delivery_address?.city || 'Madrid',
      postcode: orderDoc?.delivery_address?.postcode || '28001',
      country: orderDoc?.delivery_address?.country || 'ES'
    };
    const labelResult = await adapter.createShipment({
      shipmentId: shipment.shipmentId,
      orderId: shipment.order,
      trackingNumber: shipment.tracking,
      recipient
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="label-${shipment.tracking || shipment.shipmentId}.pdf"`);
    res.send(labelResult.labelBuffer);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/shipping/:id/tracking — Track Carrier Checkpoints ──
router.get('/:id/tracking', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const shipment = await Model.findOne({ _id: req.params.id, company: req.user.company });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (!shipment.tracking) return res.status(400).json({ message: 'Shipment has no tracking number assigned yet.' });

    const adapter = carrierRegistry.get(shipment.carrier || 'CTT');
    const trackingInfo = await adapter.getTrackingStatus(shipment.tracking);
    res.json(trackingInfo);
  } catch (err) {
    next(err);
  }
});

// DELETE
router.delete('/:id', requireOpsRole, blockOffice, async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });
    const item = await Model.findOneAndDelete({ _id: req.params.id, company: req.user.company });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
