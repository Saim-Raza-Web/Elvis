import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Company from '../models/Company.js';
import Counter from '../models/Counter.js';
import Transaction from '../models/Transaction.js';
import { calculateInvoice } from '../services/invoiceCalculationEngine.js';
import { generateInvoicePDFBuffer } from '../services/invoicePdfService.js';
import { sendInvoiceEmail, isValidEmail } from '../services/emailService.js';
import ComplianceConfig from '../models/ComplianceConfig.js';
import ComplianceOutboxEvent from '../models/ComplianceOutboxEvent.js';
import Shipment from '../models/Shipment.js';
import Order from '../models/Order.js';
import JournalEntry from '../models/JournalEntry.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';
import { IdempotencyService } from '../services/IdempotencyService.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('admin', 'manager'));

/** Helper: Generate atomic, sequential invoice number (INV-YYYY-XXXXX) */
async function generateNextInvoiceNumber(companyId, session = null) {
  const currentYear = new Date().getFullYear();
  const counterId = `invoice_${currentYear}_${companyId}`;
  const counterOpts = session ? { session, new: true, upsert: true } : { new: true, upsert: true };

  let invoiceNumber = '';
  let attempts = 0;
  while (!invoiceNumber && attempts < 50) {
    attempts++;
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId, company: companyId },
      { $inc: { seq: 1 } },
      counterOpts
    );
    const candidate = `INV-${currentYear}-${String(counter.seq).padStart(5, '0')}`;
    const exists = await Invoice.findOne({ invoiceNumber: candidate, company: companyId });
    if (!exists) {
      invoiceNumber = candidate;
    }
  }

  if (!invoiceNumber) {
    invoiceNumber = `INV-${currentYear}-${Date.now().toString().slice(-5)}`;
  }
  return invoiceNumber;
}

/** Helper: Format customer address */
function formatCustomerAddress(cust) {
  if (!cust) return '';
  const b = cust.billingAddress || {};
  return [b.street, b.number, b.postcode, b.city, b.region, b.country || cust.country].filter(Boolean).join(', ');
}

// --- Phase 8C.2 Billing Accounting Helpers ---

async function validateInvoiceQuantities(invoice, companyId, session) {
  if (!invoice.orderId && (!invoice.shipments || invoice.shipments.length === 0)) {
    return; // No linkage, skip strict reconciliation
  }
  
  let shipments = [];
  if (invoice.shipments && invoice.shipments.length > 0) {
    shipments = await Shipment.find({ _id: { $in: invoice.shipments }, company: companyId }).session(session);
  } else if (invoice.orderId) {
    const orderDoc = await Order.findById(invoice.orderId).session(session);
    if (orderDoc) {
      shipments = await Shipment.find({ order: orderDoc.orderId, company: companyId }).session(session);
    }
  }

  const shippedQty = {};
  for (const ship of shipments) {
    if (ship.financial_items) {
      for (const item of ship.financial_items) {
        shippedQty[item.sku] = (shippedQty[item.sku] || 0) + item.qty;
      }
    }
  }

  const pastInvoices = await Invoice.find({
    orderId: invoice.orderId,
    _id: { $ne: invoice._id },
    status: { $in: ['issued', 'sent', 'paid'] },
    company: companyId
  }).session(session);

  const invoicedQty = {};
  for (const inv of pastInvoices) {
    for (const line of inv.lines) {
      if (line.sku && line.itemType !== 'service') {
        invoicedQty[line.sku] = (invoicedQty[line.sku] || 0) + line.quantity;
      }
    }
  }

  for (const line of invoice.lines) {
    if (line.itemType === 'service') continue; 
    if (!line.sku) continue;
    
    const available = (shippedQty[line.sku] || 0) - (invoicedQty[line.sku] || 0);
    // float tolerance
    if (line.quantity > available + 0.001) { 
      throw new Error(`HARD INVOICING EXCEPTION: Cannot invoice ${line.quantity} of SKU ${line.sku}. Only ${available} available to invoice (Shipped: ${shippedQty[line.sku] || 0}, Previously Invoiced: ${invoicedQty[line.sku] || 0}).`);
    }
  }
}

async function createInvoiceIssuanceJE(invoice, companyId, session) {
  const accountingConfig = await CompanyAccountingConfig.findOne({ company: companyId }).session(session);
  if (!accountingConfig || !accountingConfig.defaultAccountsReceivableAccountId || !accountingConfig.defaultUnbilledReceivableAccountId || !accountingConfig.defaultTaxPayableAccountId) {
    throw new Error('HARD ACCOUNTING EXCEPTION: Missing CompanyAccountingConfig or required accounts (AR/Unbilled/Tax) for invoice issuance.');
  }

  const currentYear = new Date().getFullYear();
  const jeCounter = await Counter.findOneAndUpdate(
    { _id: `journal_entry_${currentYear}_${companyId}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  const jeNumber = `JE-${currentYear}-${String(jeCounter.seq).padStart(5, '0')}`;

  const jeId = new mongoose.Types.ObjectId();
  const netAmount = invoice.subtotal;
  const taxAmount = invoice.totalTax;
  const grossAmount = invoice.grandTotal;

  await JournalEntry.create([{
    _id: jeId,
    entryNumber: jeNumber,
    date: new Date(),
    reference: invoice.invoiceNumber,
    description: `Accounts Receivable — Invoice ${invoice.invoiceNumber} issued to ${invoice.customerName}`,
    entryType: 'customer_invoice',
    sourceDocument: { docType: 'customer_invoice', docNumber: invoice.invoiceNumber, docId: invoice._id },
    lines: [
      {
        accountId: accountingConfig.defaultAccountsReceivableAccountId,
        account: 'Accounts Receivable',
        description: 'Gross Invoice Amount',
        debit: grossAmount,
        credit: 0
      },
      {
        accountId: accountingConfig.defaultUnbilledReceivableAccountId,
        account: 'Unbilled Receivable',
        description: 'Clear Accrued Unbilled AR',
        debit: 0,
        credit: netAmount
      },
      {
        accountId: accountingConfig.defaultTaxPayableAccountId,
        account: 'Tax Payable',
        description: 'Tax Liability',
        debit: 0,
        credit: taxAmount
      }
    ],
    totalDebit: grossAmount,
    totalCredit: grossAmount,
    status: 'posted',
    postedAt: new Date(),
    company: companyId
  }], { session });

  return jeId;
}

router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['invoiceNumber', 'invoiceId', 'customerName', 'customerEmail', 'customer'],
      exact: { status: 'status' },
    });

    const result = await paginateQuery(Invoice, filter, req);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET Invoice by ID ───────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const item = await Invoice.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { invoiceNumber: req.params.id },
        { invoiceId: req.params.id }
      ],
      company: req.user.company
    }).populate('customerId');

    if (!item) return res.status(404).json({ message: 'Invoice not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── GET all Invoices ────────────────────────────────────────────────────────
// ── CREATE Invoice ──────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  const isIssued = req.body.status === 'issued';
  const session = await mongoose.startSession();
  if (isIssued) session.startTransaction();

  try {
    if (!req.user || !req.user.company) {
      if (isIssued) await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ message: 'Company context required' });
    }

    const { customerId, lines, issuedDate, dueDate, paymentTerms, notes, bankInfo, status, shipments, orderId } = req.body;

    if (!customerId) {
      if (isIssued) await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'A valid CRM Customer selection is mandatory. Selecting customer from CRM is required.' });
    }

    const customer = await Customer.findOne({ _id: customerId, company: req.user.company }).session(isIssued ? session : null);
    if (!customer) {
      if (isIssued) await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Selected CRM Customer was not found in your company records.' });
    }

    let calcResult;
    try {
      calcResult = calculateInvoice(lines);
    } catch (calcErr) {
      if (isIssued) await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: calcErr.message });
    }

    const invoiceNumber = await generateNextInvoiceNumber(req.user.company, isIssued ? session : null);
    const initialStatus = isIssued ? 'issued' : 'draft';
    const computedDue = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const invoice = new Invoice({
      invoiceNumber,
      invoiceId: invoiceNumber,
      customerId: customer._id,
      customerName: customer.name,
      customerEmail: customer.email,
      customerVat: customer.vatNumber || '',
      customerAddress: formatCustomerAddress(customer),
      customerPhone: customer.phone || '',
      lines: calcResult.lines,
      subtotal: calcResult.subtotal,
      discountTotal: calcResult.discountTotal,
      totalTax: calcResult.totalTax,
      grandTotal: calcResult.grandTotal,
      taxBreakdown: calcResult.taxBreakdown,
      status: initialStatus,
      issuedDate: issuedDate ? new Date(issuedDate) : new Date(),
      dueDate: computedDue,
      paymentTerms: paymentTerms || customer.paymentTerms || 'Net 30',
      notes: notes || '',
      bankInfo: bankInfo || customer.bankInfo || customer.iban || '',
      items: calcResult.lines.length,
      amount: calcResult.grandTotal,
      customer: customer.name,
      shipments: shipments || [],
      orderId: orderId || null,
      company: req.user.company
    });

    if (isIssued) {
      await validateInvoiceQuantities(invoice, req.user.company, session);
      
      const jeId = await createInvoiceIssuanceJE(invoice, req.user.company, session);
      invoice.accountingJournalEntryId = jeId;

      await ComplianceOutboxEvent.create([{
        company: req.user.company,
        eventType: 'INVOICE_ISSUE',
        referenceId: invoice._id,
        referenceType: 'Invoice',
        idempotencyKey: `INVOICE_ISSUANCE_OUTBOX_${invoice._id}`,
        payload: { invoiceId: invoice._id.toString(), invoiceNumber: invoice.invoiceNumber },
        status: 'PENDING'
      }], { session });

      await invoice.save({ session });
      await session.commitTransaction();
    } else {
      await invoice.save();
    }

    session.endSession();
    res.status(201).json(invoice);
  } catch (err) {
    if (isIssued) await session.abortTransaction();
    session.endSession();
    if (err.message && (err.message.includes('HARD') || err.message.includes('Company context'))) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
});

// ── UPDATE Invoice ──────────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const invoice = await Invoice.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { invoiceNumber: req.params.id },
        { invoiceId: req.params.id }
      ],
      company: req.user.company
    });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      return res.status(400).json({ message: `Cannot modify an invoice with status '${invoice.status}'.` });
    }

    const { customerId, lines, issuedDate, dueDate, paymentTerms, notes, bankInfo, status } = req.body;

    // Update customer reference if changed
    if (customerId && String(customerId) !== String(invoice.customerId)) {
      const customer = await Customer.findOne({ _id: customerId, company: req.user.company });
      if (!customer) return res.status(404).json({ message: 'Customer not found.' });
      invoice.customerId = customer._id;
      invoice.customerName = customer.name;
      invoice.customerEmail = customer.email;
      invoice.customerVat = customer.vatNumber || '';
      invoice.customerAddress = formatCustomerAddress(customer);
      invoice.customer = customer.name;
    }

    // Recalculate lines if provided
    if (Array.isArray(lines) && lines.length > 0) {
      try {
        const calcResult = calculateInvoice(lines);
        invoice.lines = calcResult.lines;
        invoice.subtotal = calcResult.subtotal;
        invoice.discountTotal = calcResult.discountTotal;
        invoice.totalTax = calcResult.totalTax;
        invoice.grandTotal = calcResult.grandTotal;
        invoice.taxBreakdown = calcResult.taxBreakdown;
        invoice.items = calcResult.lines.length;
        invoice.amount = calcResult.grandTotal;
      } catch (calcErr) {
        return res.status(400).json({ message: calcErr.message });
      }
    }

    if (issuedDate) invoice.issuedDate = new Date(issuedDate);
    if (dueDate) invoice.dueDate = new Date(dueDate);
    if (paymentTerms) invoice.paymentTerms = paymentTerms;
    if (notes !== undefined) invoice.notes = notes;
    if (bankInfo !== undefined) invoice.bankInfo = bankInfo;

    // Status transition handling
    if (status && status !== invoice.status) {
      if (status === 'issued' && invoice.status === 'draft') {
        return res.status(400).json({ message: 'Use the POST /:id/issue endpoint to issue an invoice with correct accounting.' });
      }

      const allowedTransitions = {
        draft: ['cancelled'],
        issued: ['sent', 'paid', 'cancelled'],
        sent: ['paid', 'cancelled'],
        paid: [],
        cancelled: []
      };

      const validNext = allowedTransitions[invoice.status] || [];
      if (!validNext.includes(status)) {
        return res.status(400).json({ message: `Invalid invoice state transition from '${invoice.status}' to '${status}'.` });
      }

      invoice.status = status;
    }

    await invoice.save();
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

// ── GET Invoice PDF Stream ──────────────────────────────────────────────────
router.get('/:id/pdf', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const invoice = await Invoice.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { invoiceNumber: req.params.id },
        { invoiceId: req.params.id }
      ],
      company: req.user.company
    });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const company = await Company.findById(req.user.company);
    const pdfBuffer = await generateInvoicePDFBuffer(invoice, company);

    const filename = `${invoice.invoiceNumber || invoice.invoiceId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// ── ISSUE Invoice (Finalize) ────────────────────────────────────────────────
router.post('/:id/issue', async (req, res, next) => {
  let idempotencyLock = null;
  try {
    idempotencyLock = await IdempotencyService.acquireLock(
      req.user.company,
      'INVOICE_ISSUANCE',
      `INVOICE_ISSUANCE_${req.params.id}`,
      {}
    );
    if (idempotencyLock.status === 'CACHED') return res.json(idempotencyLock.response);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ message: err.message });
    return next(err);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!req.user || !req.user.company) throw new Error('Company context required');

    const invoice = await Invoice.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { invoiceNumber: req.params.id },
        { invoiceId: req.params.id }
      ],
      company: req.user.company
    }).session(session);

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'draft') {
      throw new Error(`Only draft invoices can be issued. Current status: '${invoice.status}'.`);
    }

    await validateInvoiceQuantities(invoice, req.user.company, session);

    invoice.status = 'issued';
    invoice.issuedDate = new Date(); // Update issued date to now

    const jeId = await createInvoiceIssuanceJE(invoice, req.user.company, session);
    invoice.accountingJournalEntryId = jeId;

    await ComplianceOutboxEvent.create([{
      company: req.user.company,
      eventType: 'INVOICE_ISSUE',
      referenceId: invoice._id,
      referenceType: 'Invoice',
      idempotencyKey: `INVOICE_ISSUANCE_OUTBOX_${invoice._id}`,
      payload: { invoiceId: invoice._id.toString(), invoiceNumber: invoice.invoiceNumber },
      status: 'PENDING'
    }], { session });

    await invoice.save({ session });
    await session.commitTransaction();
    session.endSession();

    if (idempotencyLock) {
      await IdempotencyService.completeLock(idempotencyLock.record._id, { message: `Invoice ${invoice.invoiceNumber} successfully issued.`, invoice });
    }

    res.json({ message: `Invoice ${invoice.invoiceNumber} successfully issued.`, invoice });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    if (idempotencyLock && idempotencyLock.record) {
      await IdempotencyService.failLock(idempotencyLock.record._id, err).catch(e => console.error('Failed to update idempotency failure', e));
    }

    if (err.message.includes('HARD') || err.message.includes('Company context') || err.message.includes('Only draft')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
});

// ── SEND Invoice Workflow ───────────────────────────────────────────────────
router.post('/:id/send', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const invoice = await Invoice.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { invoiceNumber: req.params.id },
        { invoiceId: req.params.id }
      ],
      company: req.user.company
    });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    // 1. Recipient Email Resolution & Strict Validation
    let recipientEmail = invoice.customerEmail;
    if (invoice.customerId) {
      const cust = await Customer.findById(invoice.customerId);
      if (cust) {
        recipientEmail = cust.email || invoice.customerEmail;
      }
    }

    if (!recipientEmail || !recipientEmail.trim() || !isValidEmail(recipientEmail.trim())) {
      return res.status(400).json({
        message: `Cannot send invoice: Customer '${invoice.customerName}' does not have a valid email address configured (${recipientEmail || 'None'}). Please update the customer profile first.`
      });
    }

    // 2. Generate PDF Attachment
    const company = await Company.findById(req.user.company);
    let pdfBuffer;
    try {
      pdfBuffer = await generateInvoicePDFBuffer(invoice, company);
    } catch (pdfErr) {
      return res.status(500).json({ message: `Failed to render Invoice PDF: ${pdfErr.message}` });
    }

    // 3. Dispatch Email via Service
    let dispatchResult;
    try {
      dispatchResult = await sendInvoiceEmail({
        to: recipientEmail,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        grandTotal: invoice.grandTotal,
        currency: company?.currency || 'EUR',
        pdfBuffer,
        companyName: company?.name || 'Elvis Logistics S.L.',
      });
    } catch (sendErr) {
      if (sendErr.code === 'SMTP_NOT_CONFIGURED') {
        return res.status(503).json({
          message: 'Email delivery is not configured on this server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM environment variables.',
          code: 'SMTP_NOT_CONFIGURED'
        });
      }
      // Record failed transmission in history but DO NOT mark invoice as sent
      invoice.emailHistory.push({
        sentAt: new Date(),
        sentTo: recipientEmail,
        status: 'FAILED',
        error: sendErr.message
      });
      await invoice.save();
      return res.status(500).json({
        message: `Email Dispatch Failed: ${sendErr.message}`,
        error: sendErr.message
      });
    }

    // 4. Update Invoice Status to 'sent'
    invoice.status = 'sent';
    invoice.sentAt = dispatchResult.timestamp;
    invoice.sentTo = recipientEmail;
    invoice.sentBy = req.user.email || 'system';
    invoice.emailHistory.push({
      sentAt: dispatchResult.timestamp,
      sentTo: recipientEmail,
      status: 'SUCCESS',
      error: ''
    });

    await invoice.save();

    res.json({
      message: `Invoice ${invoice.invoiceNumber} successfully sent to ${recipientEmail}.`,
      dispatch: dispatchResult,
      invoice
    });
  } catch (err) {
    next(err);
  }
});

// ── MARK Invoice as PAID ────────────────────────────────────────────────────
router.post('/:id/pay', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const invoice = await Invoice.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { invoiceNumber: req.params.id },
        { invoiceId: req.params.id }
      ],
      company: req.user.company
    });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.status === 'paid') {
      return res.status(400).json({ message: `Invoice ${invoice.invoiceNumber} is already marked as paid.` });
    }
    if (invoice.status === 'cancelled') {
      return res.status(400).json({ message: `Cannot mark cancelled invoice ${invoice.invoiceNumber} as paid.` });
    }

    invoice.status = 'paid';

    // Record Payment in Accounting Transactions
    try {
      await Transaction.create({
        txnId: `TXN-PAY-${Date.now()}-${invoice.invoiceNumber}`,
        date: new Date(),
        description: `Payment Received — Invoice ${invoice.invoiceNumber} from ${invoice.customerName}`,
        type: 'credit',
        amount: invoice.grandTotal,
        category: 'Revenue',
        account: 'Cash & Cash Equivalents',
        company: req.user.company
      });
    } catch (txnErr) {
      console.warn('Accounting payment record warning:', txnErr.message);
    }

    await invoice.save();
    res.json({ message: `Invoice ${invoice.invoiceNumber} marked as paid.`, invoice });
  } catch (err) {
    next(err);
  }
});

// ── CANCEL Invoice ──────────────────────────────────────────────────────────
router.post('/:id/cancel', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const invoice = await Invoice.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { invoiceNumber: req.params.id },
        { invoiceId: req.params.id }
      ],
      company: req.user.company
    });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.status === 'paid') {
      return res.status(400).json({ message: `Cannot cancel paid invoice ${invoice.invoiceNumber}. Please issue a credit note instead.` });
    }

    invoice.status = 'cancelled';
    await invoice.save();
    res.json({ message: `Invoice ${invoice.invoiceNumber} has been cancelled.`, invoice });
  } catch (err) {
    next(err);
  }
});

// ── DELETE Invoice ──────────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const item = await Invoice.findOneAndDelete({
      _id: req.params.id,
      company: req.user.company,
      status: 'draft' // only allow deleting drafts
    });

    if (!item) {
      return res.status(400).json({ message: 'Invoice not found or cannot be deleted (only draft invoices can be deleted).' });
    }

    res.json({ message: 'Draft invoice deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
