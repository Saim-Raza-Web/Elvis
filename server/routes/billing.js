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
import VeriFactuRecord from '../models/VeriFactuRecord.js';
import SIIRecord from '../models/SIIRecord.js';
import ComplianceConfig from '../models/ComplianceConfig.js';
import { aeatService } from '../services/aeat.service.js';

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

// ── GET all Invoices ────────────────────────────────────────────────────────
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

// ── CREATE Invoice ──────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { customerId, lines, issuedDate, dueDate, paymentTerms, notes, bankInfo, status } = req.body;

    // 1. Customer Verification
    if (!customerId) {
      return res.status(400).json({ message: 'A valid CRM Customer selection is mandatory. Selecting customer from CRM is required.' });
    }

    const customer = await Customer.findOne({ _id: customerId, company: req.user.company });
    if (!customer) {
      return res.status(404).json({ message: 'Selected CRM Customer was not found in your company records.' });
    }

    // 2. Authoritative Calculation Engine
    let calcResult;
    try {
      calcResult = calculateInvoice(lines);
    } catch (calcErr) {
      return res.status(400).json({ message: calcErr.message });
    }

    // 3. Atomic Number Generation
    const invoiceNumber = await generateNextInvoiceNumber(req.user.company);

    const initialStatus = status === 'issued' ? 'issued' : 'draft';
    const computedDue = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const customerAddressStr = formatCustomerAddress(customer);

    // 4. Create Record
    const invoice = await Invoice.create({
      invoiceNumber,
      invoiceId: invoiceNumber,
      customerId: customer._id,
      customerName: customer.name,
      customerEmail: customer.email,
      customerVat: customer.vatNumber || '',
      customerAddress: customerAddressStr,
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
      company: req.user.company
    });

    // 5. Accounting Integration (if created directly as 'issued')
    if (initialStatus === 'issued') {
      try {
        const txn = await Transaction.create({
          transactionId: `TXN-${invoiceNumber}`,
          reference: invoiceNumber,
          date: new Date(),
          description: `Accounts Receivable — Invoice ${invoiceNumber} issued to ${customer.name}`,
          type: 'credit',
          amount: calcResult.grandTotal,
          category: 'Revenue',
          account: 'Accounts Receivable',
          status: 'posted',
          company: req.user.company
        });
        invoice.accountingTransactionId = txn._id;
        await invoice.save();
      } catch (txnErr) {
        console.warn('Accounting ledger record warning:', txnErr.message);
      }

      // --- Compliance Integration (VeriFactu / SII) ---
      try {
        const compConfig = await ComplianceConfig.findOne({ company: req.user.company });
        if (compConfig) {
          if (compConfig.verifactuEnabled) {
            const hashData = await aeatService.generateVeriFactuHash(req.user.company, {
              issuerNif: req.user.company, // Fallback, normally from Company config
              invoiceNumber: invoice.invoiceNumber,
              date: invoice.issuedDate.toISOString().split('T')[0],
              type: 'F1',
              totalAmount: invoice.grandTotal
            });
            const vfRecord = await VeriFactuRecord.create({
              company: req.user.company,
              invoiceId: invoice._id,
              recordType: 'ISSUED',
              invoiceNumber: invoice.invoiceNumber,
              issueDate: invoice.issuedDate,
              issuerTaxId: 'TBD', // In real app get from Company profile
              totalAmount: invoice.grandTotal,
              taxAmount: invoice.totalTax,
              previousRecordHash: hashData.previousHash,
              currentHash: hashData.hash,
              status: compConfig.certificatePfxEncrypted ? 'PENDING' : 'ERROR',
              lastError: compConfig.certificatePfxEncrypted ? '' : 'AEAT certificate missing'
            });
          }
          if (compConfig.siiEnabled) {
            await SIIRecord.create({
              company: req.user.company,
              invoiceId: invoice._id,
              recordType: 'ISSUED',
              invoiceNumber: invoice.invoiceNumber,
              invoiceDate: invoice.issuedDate,
              taxPeriod: `${new Date(invoice.issuedDate).getFullYear()}-${String(new Date(invoice.issuedDate).getMonth() + 1).padStart(2, '0')}`,
              counterpartyTaxId: invoice.customerVat || 'GENERIC',
              counterpartyName: invoice.customerName,
              taxBase: invoice.subtotal,
              taxAmount: invoice.totalTax,
              totalAmount: invoice.grandTotal,
              status: compConfig.certificatePfxEncrypted ? 'PENDING' : 'ERROR',
              lastError: compConfig.certificatePfxEncrypted ? '' : 'AEAT certificate missing'
            });
          }
        }
      } catch (err) {
        console.warn('Compliance record creation failed:', err.message);
      }
    }

    res.status(201).json(invoice);
  } catch (err) {
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
      const allowedTransitions = {
        draft: ['issued', 'cancelled'],
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
    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: `Only draft invoices can be issued. Current status: '${invoice.status}'.` });
    }

    invoice.status = 'issued';

    // Post to accounting
    try {
      const txn = await Transaction.create({
        transactionId: `TXN-${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        date: new Date(),
        description: `Accounts Receivable — Invoice ${invoice.invoiceNumber} issued to ${invoice.customerName}`,
        type: 'credit',
        amount: invoice.grandTotal,
        category: 'Revenue',
        account: 'Accounts Receivable',
        status: 'posted',
        company: req.user.company
      });
      invoice.accountingTransactionId = txn._id;
    } catch (txnErr) {
      console.warn('Accounting ledger warning:', txnErr.message);
    }

    // --- Compliance Integration (VeriFactu / SII) ---
    try {
      const compConfig = await ComplianceConfig.findOne({ company: req.user.company });
      if (compConfig) {
        if (compConfig.verifactuEnabled) {
          const hashData = await aeatService.generateVeriFactuHash(req.user.company, {
            issuerNif: req.user.company, // Fallback, normally from Company config
            invoiceNumber: invoice.invoiceNumber,
            date: invoice.issuedDate.toISOString().split('T')[0],
            type: 'F1',
            totalAmount: invoice.grandTotal
          });
          const vfRecord = await VeriFactuRecord.create({
            company: req.user.company,
            invoiceId: invoice._id,
            recordType: 'ISSUED',
            invoiceNumber: invoice.invoiceNumber,
            issueDate: invoice.issuedDate,
            issuerTaxId: 'TBD', // In real app get from Company profile
            totalAmount: invoice.grandTotal,
            taxAmount: invoice.totalTax,
            previousRecordHash: hashData.previousHash,
            currentHash: hashData.hash,
            status: compConfig.certificatePfxEncrypted ? 'PENDING' : 'ERROR',
            lastError: compConfig.certificatePfxEncrypted ? '' : 'AEAT certificate missing'
          });
        }
        if (compConfig.siiEnabled) {
          await SIIRecord.create({
            company: req.user.company,
            invoiceId: invoice._id,
            recordType: 'ISSUED',
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.issuedDate,
            taxPeriod: `${new Date(invoice.issuedDate).getFullYear()}-${String(new Date(invoice.issuedDate).getMonth() + 1).padStart(2, '0')}`,
            counterpartyTaxId: invoice.customerVat || 'GENERIC',
            counterpartyName: invoice.customerName,
            taxBase: invoice.subtotal,
            taxAmount: invoice.totalTax,
            totalAmount: invoice.grandTotal,
            status: compConfig.certificatePfxEncrypted ? 'PENDING' : 'ERROR',
            lastError: compConfig.certificatePfxEncrypted ? '' : 'AEAT certificate missing'
          });
        }
      }
    } catch (err) {
      console.warn('Compliance record creation failed:', err.message);
    }

    await invoice.save();
    res.json({ message: `Invoice ${invoice.invoiceNumber} successfully issued.`, invoice });
  } catch (err) {
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
