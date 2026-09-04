import express from 'express';
import mongoose from 'mongoose';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import SupplierBill from '../models/SupplierBill.js';
import JournalEntry from '../models/JournalEntry.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';
import Company from '../models/Company.js';
import SIIRecord from '../models/SIIRecord.js';
import ComplianceConfig from '../models/ComplianceConfig.js';
import { aeatService } from '../services/aeat.service.js';
import { protect } from '../middleware/auth.js';
import { validateWarehouse } from '../middleware/warehouseValidator.js';
import { generatePurchaseOrderPDFBuffer } from '../services/PurchaseOrderPdfService.js';
import { sendPurchaseOrderEmail } from '../services/emailService.js';

const router = express.Router();
router.use(protect);
router.use(validateWarehouse);


// Helper to generate PO numbers
async function generatePoNumber(companyId) {
  const latestPo = await PurchaseOrder.findOne({ company: companyId }).sort({ createdAt: -1 });
  let nextSeq = 1;
  if (latestPo && latestPo.poNumber) {
    const match = latestPo.poNumber.match(/PO-\d{4}-(\d+)/);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  }
  const year = new Date().getFullYear();
  return `PO-${year}-${String(nextSeq).padStart(5, '0')}`;
}

// GET all POs
router.get('/', async (req, res, next) => {
  try {
    const pos = await PurchaseOrder.find({ company: req.user.company })
      .populate('supplierId', 'name')
      .sort({ createdAt: -1 });
    res.json(pos);
  } catch (err) {
    next(err);
  }
});

// GET single PO
router.get('/:id', async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: req.user.company })
      .populate('supplierId', 'name')
      .populate('sourceOrderId', 'orderId status');
    if (!po) return res.status(404).json({ message: 'Purchase Order not found' });
    res.json(po);
  } catch (err) {
    next(err);
  }
});

// POST create PO
router.post('/', async (req, res, next) => {
  try {
    const { supplierId, expectedDeliveryDate, currency, notes, supplierReference, lines } = req.body;
    
    if (req.context && req.context.warehouses && req.context.warehouses.length > 1) {
      return res.status(400).json({ message: 'Multiple warehouses provided. This endpoint requires exactly one warehouse.' });
    }
    const warehouse = req.context?.warehouse?.code;

    if (!supplierId || !warehouse || !lines || lines.length === 0) {
      return res.status(400).json({ message: 'Supplier, warehouse, and lines are required.' });
    }

    const supplier = await Supplier.findOne({ _id: supplierId, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    const poNumber = await generatePoNumber(req.user.company);

    const po = new PurchaseOrder({
      poNumber,
      company: req.user.company,
      supplierId,
      expectedDeliveryDate,
      currency: currency || supplier.paymentInfo.currency || 'EUR',
      warehouse,
      notes: notes || '',
      supplierReference: supplierReference || '',
      lines: lines.map(line => {
        const qty = Number(line.quantityOrdered) || 1;
        const cost = Number(line.unitCost) || 0;
        const taxRate = Number(line.taxRate) || 21;
        
        const lineSubtotal = parseFloat((qty * cost).toFixed(2));
        const taxAmount = parseFloat((lineSubtotal * (taxRate / 100)).toFixed(2));
        const lineTotal = parseFloat((lineSubtotal + taxAmount).toFixed(2));
        
        return {
          productId: line.productId,
          sku: line.sku,
          supplierSku: line.supplierSku || '',
          description: line.description,
          quantityOrdered: qty,
          unitCost: cost,
          taxRate,
          lineSubtotal,
          taxAmount,
          lineTotal
        };
      })
    });

    await po.save();
    res.status(201).json(po);
  } catch (err) {
    next(err);
  }
});

// POST Confirm PO
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: req.user.company });
    if (!po) return res.status(404).json({ message: 'Purchase Order not found' });
    
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ message: `Cannot confirm PO in ${po.status} status.` });
    }
    
    po.status = 'CONFIRMED';
    await po.save();
    res.json(po);
  } catch (err) {
    next(err);
  }
});

// POST Cancel PO
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: req.user.company });
    if (!po) return res.status(404).json({ message: 'Purchase Order not found' });
    
    if (!['DRAFT', 'CONFIRMED'].includes(po.status)) {
      return res.status(400).json({ message: `Cannot cancel PO in ${po.status} status.` });
    }
    
    po.status = 'CANCELLED';
    await po.save();
    res.json(po);
  } catch (err) {
    next(err);
  }
});

// POST Send PO to Supplier
router.post('/:id/send', async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: req.user.company })
      .populate('supplierId');
    if (!po) return res.status(404).json({ message: 'Purchase Order not found' });

    if (po.status === 'DRAFT') {
      return res.status(400).json({ message: 'Cannot send a DRAFT purchase order. Please confirm it first.' });
    }

    // Resolve supplier email — field is 'email' on the Supplier schema
    const supplierEmail = po.supplierId?.email;
    if (!supplierEmail || !supplierEmail.trim()) {
      return res.status(400).json({
        message: `Cannot send PO: Supplier '${po.supplierId?.name || 'Unknown'}' does not have an email address configured. Please update the supplier profile first.`
      });
    }

    const company = await Company.findById(req.user.company);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    // Generate PDF
    let pdfBuffer;
    try {
      pdfBuffer = await generatePurchaseOrderPDFBuffer(po, company);
    } catch (pdfErr) {
      return res.status(500).json({ message: `Failed to render PO PDF: ${pdfErr.message}` });
    }

    // Calculate grand total
    let grandTotal = 0;
    po.lines.forEach(line => { grandTotal += (line.lineTotal || 0); });

    // Send Email — throws SMTP_NOT_CONFIGURED if SMTP env vars are absent
    let dispatchResult;
    try {
      dispatchResult = await sendPurchaseOrderEmail({
        to: supplierEmail,
        poNumber: po.poNumber,
        supplierName: po.supplierId.name,
        grandTotal,
        currency: po.currency || company.currency || 'EUR',
        pdfBuffer,
        companyName: company.name
      });
    } catch (sendErr) {
      if (sendErr.code === 'SMTP_NOT_CONFIGURED') {
        return res.status(503).json({
          message: 'Email delivery is not configured on this server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM environment variables.',
          code: 'SMTP_NOT_CONFIGURED'
        });
      }
      // Log and surface SMTP delivery failures
      console.error(`[PO SEND] SMTP delivery failed for PO ${po.poNumber}:`, sendErr.message);
      return res.status(500).json({
        message: `Email dispatch failed: ${sendErr.message}`,
        code: sendErr.code || 'SMTP_DELIVERY_FAILED'
      });
    }

    // Mark PO as sent
    po.status = 'SENT';
    po.sentAt  = dispatchResult.timestamp;
    po.sentTo  = supplierEmail;
    await po.save();

    res.json({
      message: `Purchase Order ${po.poNumber} successfully sent to ${supplierEmail}.`,
      dispatchResult
    });
  } catch (err) {
    next(err);
  }
});

// POST Create Supplier Bill
router.post('/:id/bill', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { supplierInvoiceNumber, billDate, dueDate } = req.body;
    
    if (!supplierInvoiceNumber) throw new Error('supplierInvoiceNumber is required');

    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: req.user.company }).session(session);
    if (!po) throw new Error('Purchase Order not found');
    
    if (!['RECEIVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new Error(`Cannot bill a PO in ${po.status} status.`);
    }

    const supplier = await Supplier.findOne({ _id: po.supplierId }).session(session);
    if (!supplier || !supplier.accountingInfo || !supplier.accountingInfo.ledgerAccountId) {
      throw new Error('Supplier accounting configuration is incomplete. Cannot bill.');
    }

    const config = await CompanyAccountingConfig.findOne({ company: req.user.company }).session(session);
    if (!config || !config.defaultPurchaseExpenseAccountId || !config.defaultInputVATAccountId) {
      throw new Error('Company accounting configuration is incomplete. Must configure Purchase Expense and Input VAT accounts.');
    }

    // Build Bill Lines from unbilled received quantities
    const billLines = [];
    let subtotal = 0;
    let totalTax = 0;
    
    po.lines.forEach(line => {
      const unbilledQty = line.quantityReceived - line.quantityBilled;
      if (unbilledQty > 0) {
        const lineSub = parseFloat((unbilledQty * line.unitCost).toFixed(2));
        const lineTax = parseFloat((lineSub * (line.taxRate / 100)).toFixed(2));
        
        billLines.push({
          expenseAccount: config.defaultPurchaseExpenseAccountCode,
          description: line.description,
          quantity: unbilledQty,
          unitPrice: line.unitCost,
          taxRate: line.taxRate,
          lineSubtotal: lineSub,
          lineTax: lineTax,
          lineTotal: parseFloat((lineSub + lineTax).toFixed(2))
        });
        
        subtotal += lineSub;
        totalTax += lineTax;
        
        // Update PO line
        line.quantityBilled += unbilledQty;
      }
    });

    if (billLines.length === 0) {
      throw new Error('No unbilled received quantities to bill.');
    }

    const grandTotal = parseFloat((subtotal + totalTax).toFixed(2));

    const billCount = await SupplierBill.countDocuments({ company: req.user.company });
    const billNumber = `BILL-${new Date().getFullYear()}-${String(billCount + 1).padStart(5, '0')}`;

    const newBill = new SupplierBill({
      billNumber,
      supplierId: supplier._id,
      supplierName: supplier.name,
      supplierTaxId: supplier.taxId || '',
      supplierInvoiceNumber,
      billDate: billDate || new Date(),
      dueDate: dueDate,
      currency: po.currency,
      lines: billLines,
      subtotal,
      totalTax,
      grandTotal,
      outstandingAmount: grandTotal,
      status: 'posted',
      postedAt: new Date(),
      postedBy: req.user.id || 'System',
      company: req.user.company
    });

    // Create Journal Entry
    const jeCount = await JournalEntry.countDocuments({ company: req.user.company });
    const jeNumber = `JE-${new Date().getFullYear()}-${String(jeCount + 1).padStart(6, '0')}`;

    const journalEntry = new JournalEntry({
      entryNumber: jeNumber,
      date: newBill.billDate,
      reference: newBill.billNumber,
      description: `Supplier Bill ${newBill.billNumber} from PO ${po.poNumber}`,
      status: 'posted',
      lines: [
        {
          accountId: config.defaultPurchaseExpenseAccountId,
          accountCodeSnapshot: config.defaultPurchaseExpenseAccountCode,
          account: config.defaultPurchaseExpenseAccountCode,
          debit: subtotal,
          credit: 0
        },
        {
          accountId: config.defaultInputVATAccountId,
          accountCodeSnapshot: config.defaultInputVATAccountCode,
          account: config.defaultInputVATAccountCode,
          debit: totalTax,
          credit: 0
        },
        {
          accountId: supplier.accountingInfo.ledgerAccountId,
          accountCodeSnapshot: supplier.accountingInfo.accountCode,
          account: supplier.accountingInfo.accountCode,
          debit: 0,
          credit: grandTotal
        }
      ],
      company: req.user.company
    });

    await journalEntry.save({ session });
    
    newBill.journalEntryId = journalEntry._id;
    await newBill.save({ session });

    // --- SII Compliance Integration ---
    const compConfig = await ComplianceConfig.findOne({ company: req.user.company }).session(session);
    if (compConfig && compConfig.siiEnabled) {
      const siiRecord = new SIIRecord({
        company: req.user.company,
        supplierBillId: newBill._id,
        recordType: 'RECEIVED',
        invoiceNumber: newBill.supplierInvoiceNumber,
        invoiceDate: newBill.billDate,
        taxPeriod: `${new Date(newBill.billDate).getFullYear()}-${String(new Date(newBill.billDate).getMonth() + 1).padStart(2, '0')}`,
        counterpartyTaxId: newBill.supplierTaxId,
        counterpartyName: newBill.supplierName,
        taxBase: newBill.subtotal,
        taxAmount: newBill.totalTax,
        totalAmount: newBill.grandTotal,
        status: compConfig.certificatePfxEncrypted ? 'PENDING' : 'ERROR',
        lastError: compConfig.certificatePfxEncrypted ? '' : 'AEAT certificate missing'
      });
      await siiRecord.save({ session });
    }

    // Check if PO is completely billed
    let completelyBilled = true;
    po.lines.forEach(line => {
      if (line.quantityBilled < line.quantityOrdered) completelyBilled = false;
    });

    if (completelyBilled) {
      po.status = 'BILLED'; // or COMPLETED based on your lifecycle
    }
    
    await po.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    res.status(201).json({ bill: newBill, po });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: err.message });
  }
});

export default router;
