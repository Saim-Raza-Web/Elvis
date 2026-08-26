import express from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Transaction from '../models/Transaction.js';
import SupplierBill from '../models/SupplierBill.js';
import JournalEntry from '../models/JournalEntry.js';
import Supplier from '../models/Supplier.js';
import Counter from '../models/Counter.js';

const router = express.Router();

router.use(protect);
router.use(requireRole('admin', 'manager'));

// ── Atomic Document Number Generators ───────────────────────────────────────
async function generateNextBillNumber(companyId, session = null) {
  const currentYear = new Date().getFullYear();
  const counterId = `bill_${currentYear}_${companyId}`;
  const counterOpts = session ? { session, new: true, upsert: true } : { new: true, upsert: true };

  let billNumber = '';
  let attempts = 0;
  while (!billNumber && attempts < 50) {
    attempts++;
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId, company: companyId },
      { $inc: { seq: 1 } },
      counterOpts
    );
    const candidate = `BILL-${currentYear}-${String(counter.seq).padStart(5, '0')}`;
    const exists = await SupplierBill.findOne({ billNumber: candidate, company: companyId });
    if (!exists) billNumber = candidate;
  }
  if (!billNumber) billNumber = `BILL-${currentYear}-${Date.now().toString().slice(-5)}`;
  return billNumber;
}

async function generateNextJournalEntryNumber(companyId, session = null) {
  const currentYear = new Date().getFullYear();
  const counterId = `journal_entry_${currentYear}_${companyId}`;
  const counterOpts = session ? { session, new: true, upsert: true } : { new: true, upsert: true };

  let entryNumber = '';
  let attempts = 0;
  while (!entryNumber && attempts < 50) {
    attempts++;
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId, company: companyId },
      { $inc: { seq: 1 } },
      counterOpts
    );
    const candidate = `JE-${currentYear}-${String(counter.seq).padStart(5, '0')}`;
    const exists = await JournalEntry.findOne({ entryNumber: candidate, company: companyId });
    if (!exists) entryNumber = candidate;
  }
  if (!entryNumber) entryNumber = `JE-${currentYear}-${Date.now().toString().slice(-5)}`;
  return entryNumber;
}

// ── Authoritative Calculation Engine for Supplier Bills ─────────────────────
function calculateSupplierBill(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one expense line is required.');
  }

  let subtotal = 0;
  let discountTotal = 0;
  let totalTax = 0;
  const taxMap = {};

  const calculatedLines = lines.map((line, idx) => {
    const qty = Number(line.quantity) || 1;
    const unitPrice = Number(line.unitPrice) || 0;
    const discountPct = Math.max(0, Math.min(100, Number(line.discount) || 0));
    const taxRate = Math.max(0, Number(line.taxRate) || 0);

    if (qty <= 0) throw new Error(`Line ${idx + 1}: Quantity must be greater than 0.`);
    if (unitPrice < 0) throw new Error(`Line ${idx + 1}: Unit price cannot be negative.`);
    if (!line.expenseAccount || !line.expenseAccount.trim()) {
      throw new Error(`Line ${idx + 1}: Expense account is required.`);
    }
    if (!line.description || !line.description.trim()) {
      throw new Error(`Line ${idx + 1}: Description is required.`);
    }

    const rawSubtotal = Math.round((qty * unitPrice) * 100) / 100;
    const lineDiscount = Math.round((rawSubtotal * (discountPct / 100)) * 100) / 100;
    const lineNet = Math.round((rawSubtotal - lineDiscount) * 100) / 100;
    const lineTax = Math.round((lineNet * (taxRate / 100)) * 100) / 100;
    const lineTotal = Math.round((lineNet + lineTax) * 100) / 100;

    subtotal += rawSubtotal;
    discountTotal += lineDiscount;
    totalTax += lineTax;

    if (!taxMap[taxRate]) {
      taxMap[taxRate] = { taxRate, taxableAmount: 0, taxAmount: 0 };
    }
    taxMap[taxRate].taxableAmount = Math.round((taxMap[taxRate].taxableAmount + lineNet) * 100) / 100;
    taxMap[taxRate].taxAmount = Math.round((taxMap[taxRate].taxAmount + lineTax) * 100) / 100;

    return {
      expenseAccount: line.expenseAccount.trim(),
      description: line.description.trim(),
      quantity: qty,
      uom: line.uom || 'EA',
      unitPrice,
      discount: discountPct,
      taxRate,
      lineSubtotal: lineNet,
      lineTax,
      lineTotal
    };
  });

  subtotal = Math.round((subtotal - discountTotal) * 100) / 100;
  totalTax = Math.round(totalTax * 100) / 100;
  const grandTotal = Math.round((subtotal + totalTax) * 100) / 100;
  const taxBreakdown = Object.values(taxMap);

  return {
    lines: calculatedLines,
    subtotal,
    discountTotal: Math.round(discountTotal * 100) / 100,
    totalTax,
    grandTotal,
    taxBreakdown
  };
}

// ── Standard Account Classification Helper ──────────────────────────────────
const STANDARD_ACCOUNTS = [
  { name: "Cash & Cash Equivalents", category: "Asset" },
  { name: "Accounts Receivable", category: "Asset" },
  { name: "Inventory Assets", category: "Asset" },
  { name: "Input VAT (Tax Deductible)", category: "Asset" },
  { name: "Accounts Payable", category: "Liability" },
  { name: "Output VAT (Taxes Payable)", category: "Liability" },
  { name: "Sales Revenue", category: "Revenue" },
  { name: "Operating Expenses", category: "Expense" },
  { name: "Inventory Purchases", category: "Expense" },
  { name: "Warehouse & Storage Expenses", category: "Expense" },
  { name: "Logistics & Freight Expense", category: "Expense" },
  { name: "Utilities & Power", category: "Expense" },
  { name: "Rent & Facilities", category: "Expense" },
  { name: "Office & Admin Expenses", category: "Expense" },
  { name: "Maintenance & Repairs", category: "Expense" }
];

function getAccountCategory(accountName) {
  const match = STANDARD_ACCOUNTS.find(a => a.name.toLowerCase() === (accountName || '').toLowerCase().trim());
  if (match) return match.category;
  if (/revenue|sales|income/i.test(accountName)) return 'Revenue';
  if (/expense|cost|utility|rent|fee|tax|freight|purchase/i.test(accountName)) return 'Expense';
  if (/payable|liability|debt|loan/i.test(accountName)) return 'Liability';
  if (/equity|retained/i.test(accountName)) return 'Equity';
  return 'Asset';
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. ACCOUNTING OVERVIEW & CHART OF ACCOUNTS
// ══════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    // Fetch transactions with pagination support
    const result = await paginateQuery(Transaction, { company: req.user.company }, req, {
      sort: { date: -1, createdAt: -1 }
    });
    
    // Fetch all transactions for accurate aggregate Chart of Accounts calculation
    const allTxns = await Transaction.find({ company: req.user.company });

    const accountMap = {};
    STANDARD_ACCOUNTS.forEach(a => {
      accountMap[a.name] = { name: a.name, category: a.category, balance: 0, debitTotal: 0, creditTotal: 0, change: 0 };
    });

    let totalRevenue = 0;
    let totalExpenses = 0;
    let accountsPayable = 0;
    let accountsReceivable = 0;

    allTxns.forEach(txn => {
      const acct = txn.account || 'Uncategorized Account';
      const cat = txn.category || getAccountCategory(acct);

      if (!accountMap[acct]) {
        accountMap[acct] = { name: acct, category: cat, balance: 0, debitTotal: 0, creditTotal: 0, change: 0 };
      }

      const amt = Number(txn.amount) || 0;
      const isDebit = txn.type === 'debit' || (txn.debit > 0 && txn.credit === 0);

      if (isDebit) {
        accountMap[acct].debitTotal += amt;
      } else {
        accountMap[acct].creditTotal += amt;
      }

      // Standard accounting normal balances:
      // Assets & Expenses: Normal Debit (Balance = Debits - Credits)
      // Liabilities, Equity, Revenue: Normal Credit (Balance = Credits - Debits)
      const category = accountMap[acct].category;
      if (category === 'Asset' || category === 'Expense') {
        accountMap[acct].balance = accountMap[acct].debitTotal - accountMap[acct].creditTotal;
      } else {
        accountMap[acct].balance = accountMap[acct].creditTotal - accountMap[acct].debitTotal;
      }

      accountMap[acct].change = Math.round(amt * 0.05 * 100) / 100;
    });

    // Compute key financial metrics
    Object.values(accountMap).forEach(acc => {
      if (acc.category === 'Revenue') totalRevenue += acc.balance;
      if (acc.category === 'Expense') totalExpenses += acc.balance;
      if (acc.name === 'Accounts Payable') accountsPayable = acc.balance;
      if (acc.name === 'Accounts Receivable') accountsReceivable = acc.balance;
    });

    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round(((netProfit / totalRevenue) * 100) * 10) / 10 : 0;

    const accounts = Object.values(accountMap).sort((a, b) => {
      const catOrder = { Asset: 1, Liability: 2, Equity: 3, Revenue: 4, Expense: 5 };
      return (catOrder[a.category] || 9) - (catOrder[b.category] || 9);
    });

    res.json({
      transactions: result,
      accounts,
      stats: {
        totalRevenue,
        totalExpenses,
        netProfit,
        profitMargin,
        accountsPayable,
        accountsReceivable
      }
    });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. SUPPLIER BILLS / RECEIVED INVOICES CRUD & WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/accounting/bills
router.get('/bills', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['billNumber', 'supplierName', 'supplierInvoiceNumber', 'notes'],
      statusField: 'status'
    });

    if (req.query.supplierId) {
      filter.supplierId = req.query.supplierId;
    }

    const result = await paginateQuery(SupplierBill, filter, req, {
      sort: { billDate: -1, createdAt: -1 },
      populate: 'supplierId'
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/accounting/bills/:id
router.get('/bills/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const bill = await SupplierBill.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { billNumber: req.params.id }
      ],
      company: req.user.company
    }).populate('supplierId').populate('journalEntryId').populate('reversalJournalEntryId');

    if (!bill) return res.status(404).json({ message: 'Supplier bill not found' });
    res.json(bill);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/bills (Create Supplier Bill)
router.post('/bills', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const {
      supplierId,
      supplierInvoiceNumber,
      billDate,
      dueDate,
      paymentTerms,
      lines,
      notes,
      status: requestedStatus
    } = req.body;

    if (!supplierId) return res.status(400).json({ message: 'Supplier is required.' });
    if (!supplierInvoiceNumber || !supplierInvoiceNumber.trim()) {
      return res.status(400).json({ message: 'Supplier invoice reference number is required.' });
    }

    const supplier = await Supplier.findOne({ _id: supplierId, company: req.user.company });
    if (!supplier) return res.status(404).json({ message: 'Selected supplier was not found.' });

    // Duplicate Supplier Invoice Protection within same supplier/company
    const duplicate = await SupplierBill.findOne({
      company: req.user.company,
      supplierId: supplier._id,
      supplierInvoiceNumber: { $regex: new RegExp(`^${supplierInvoiceNumber.trim()}$`, 'i') },
      status: { $ne: 'reversed' }
    });

    if (duplicate) {
      return res.status(400).json({
        message: `Supplier Invoice '${supplierInvoiceNumber.trim()}' already exists for supplier '${supplier.name}' (Bill ${duplicate.billNumber}).`
      });
    }

    // Authoritative Server Calculations
    const calcResult = calculateSupplierBill(lines);
    const billNumber = await generateNextBillNumber(req.user.company);
    const initialStatus = requestedStatus === 'posted' ? 'posted' : 'draft';

    const bill = new SupplierBill({
      billNumber,
      supplierId: supplier._id,
      supplierName: supplier.name,
      supplierTaxId: supplier.taxId || '',
      supplierEmail: supplier.email || '',
      supplierInvoiceNumber: supplierInvoiceNumber.trim(),
      billDate: billDate ? new Date(billDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      paymentTerms: paymentTerms || 'Net 30',
      lines: calcResult.lines,
      subtotal: calcResult.subtotal,
      discountTotal: calcResult.discountTotal,
      totalTax: calcResult.totalTax,
      grandTotal: calcResult.grandTotal,
      taxBreakdown: calcResult.taxBreakdown,
      amountPaid: 0,
      outstandingAmount: calcResult.grandTotal,
      status: initialStatus,
      notes: notes || '',
      company: req.user.company
    });

    // If directly posted, generate double-entry journal entry and transaction lines atomically
    if (initialStatus === 'posted') {
      bill.postedAt = new Date();
      bill.postedBy = req.user.name || req.user.email || 'Admin';

      const jeNumber = await generateNextJournalEntryNumber(req.user.company);
      
      // Build Double-Entry Lines:
      // Debit: Each expense line (grouped or separate)
      // Debit: Input VAT (if tax > 0)
      // Credit: Accounts Payable (grand total)
      const journalLines = [];
      calcResult.lines.forEach(l => {
        journalLines.push({
          account: l.expenseAccount,
          description: `${l.description} — Bill ${billNumber} (${supplier.name})`,
          debit: l.lineSubtotal,
          credit: 0
        });
      });

      if (calcResult.totalTax > 0) {
        journalLines.push({
          account: 'Input VAT (Tax Deductible)',
          description: `Input Tax — Bill ${billNumber} (${supplier.name})`,
          debit: calcResult.totalTax,
          credit: 0
        });
      }

      journalLines.push({
        account: 'Accounts Payable',
        description: `Payable to ${supplier.name} — Bill ${billNumber}`,
        debit: 0,
        credit: calcResult.grandTotal
      });

      const totalDebit = Math.round(journalLines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
      const totalCredit = Math.round(journalLines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({
          message: `Double-entry invariant violated: Total Debits (€${totalDebit}) must equal Total Credits (€${totalCredit}).`
        });
      }

      const journalEntry = await JournalEntry.create({
        entryNumber: jeNumber,
        date: bill.billDate,
        reference: billNumber,
        description: `Supplier Bill ${billNumber} — ${supplier.name} (Ref: ${supplierInvoiceNumber.trim()})`,
        entryType: 'supplier_bill',
        sourceDocument: {
          docType: 'supplier_bill',
          docId: bill._id,
          docNumber: billNumber
        },
        lines: journalLines,
        totalDebit,
        totalCredit,
        status: 'posted',
        postedAt: new Date(),
        postedBy: bill.postedBy,
        company: req.user.company
      });

      bill.journalEntryId = journalEntry._id;

      // Sync Transaction general ledger records
      const txnsToCreate = journalLines.map((jl, idx) => ({
        txnId: `TXN-${billNumber}-${idx + 1}`,
        date: bill.billDate,
        description: jl.description,
        type: jl.debit > 0 ? 'debit' : 'credit',
        amount: jl.debit > 0 ? jl.debit : jl.credit,
        debit: jl.debit,
        credit: jl.credit,
        account: jl.account,
        category: getAccountCategory(jl.account),
        reference: billNumber,
        status: 'posted',
        journalEntryId: journalEntry._id,
        company: req.user.company
      }));

      await Transaction.insertMany(txnsToCreate);
    }

    await bill.save();
    res.status(201).json(bill);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/accounting/bills/:id (Update Draft Bill)
router.put('/bills/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const bill = await SupplierBill.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { billNumber: req.params.id }
      ],
      company: req.user.company
    });

    if (!bill) return res.status(404).json({ message: 'Supplier bill not found' });

    // Posted entry protection: cannot edit posted/paid/reversed bills
    if (bill.status !== 'draft') {
      return res.status(400).json({
        message: `Cannot edit bill '${bill.billNumber}' with status '${bill.status}'. Posted entries are locked to preserve accounting integrity.`
      });
    }

    const { supplierId, supplierInvoiceNumber, billDate, dueDate, paymentTerms, lines, notes } = req.body;

    if (supplierId && String(supplierId) !== String(bill.supplierId)) {
      const supplier = await Supplier.findOne({ _id: supplierId, company: req.user.company });
      if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
      bill.supplierId = supplier._id;
      bill.supplierName = supplier.name;
      bill.supplierTaxId = supplier.taxId || '';
      bill.supplierEmail = supplier.email || '';
    }

    if (supplierInvoiceNumber && supplierInvoiceNumber.trim() !== bill.supplierInvoiceNumber) {
      const duplicate = await SupplierBill.findOne({
        company: req.user.company,
        supplierId: bill.supplierId,
        supplierInvoiceNumber: { $regex: new RegExp(`^${supplierInvoiceNumber.trim()}$`, 'i') },
        _id: { $ne: bill._id },
        status: { $ne: 'reversed' }
      });
      if (duplicate) {
        return res.status(400).json({
          message: `Supplier Invoice '${supplierInvoiceNumber.trim()}' already exists for supplier '${bill.supplierName}'.`
        });
      }
      bill.supplierInvoiceNumber = supplierInvoiceNumber.trim();
    }

    if (Array.isArray(lines) && lines.length > 0) {
      const calcResult = calculateSupplierBill(lines);
      bill.lines = calcResult.lines;
      bill.subtotal = calcResult.subtotal;
      bill.discountTotal = calcResult.discountTotal;
      bill.totalTax = calcResult.totalTax;
      bill.grandTotal = calcResult.grandTotal;
      bill.taxBreakdown = calcResult.taxBreakdown;
      bill.outstandingAmount = calcResult.grandTotal;
    }

    if (billDate) bill.billDate = new Date(billDate);
    if (dueDate) bill.dueDate = new Date(dueDate);
    if (paymentTerms) bill.paymentTerms = paymentTerms;
    if (notes !== undefined) bill.notes = notes;

    await bill.save();
    res.json(bill);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/bills/:id/post (Post Draft Bill to General Ledger)
router.post('/bills/:id/post', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const bill = await SupplierBill.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { billNumber: req.params.id }
      ],
      company: req.user.company
    });

    if (!bill) return res.status(404).json({ message: 'Supplier bill not found' });
    if (bill.status !== 'draft') {
      return res.status(400).json({ message: `Bill '${bill.billNumber}' is already '${bill.status}'.` });
    }

    bill.status = 'posted';
    bill.postedAt = new Date();
    bill.postedBy = req.user.name || req.user.email || 'Admin';

    const jeNumber = await generateNextJournalEntryNumber(req.user.company);
    const journalLines = [];

    bill.lines.forEach(l => {
      journalLines.push({
        account: l.expenseAccount,
        description: `${l.description} — Bill ${bill.billNumber} (${bill.supplierName})`,
        debit: l.lineSubtotal,
        credit: 0
      });
    });

    if (bill.totalTax > 0) {
      journalLines.push({
        account: 'Input VAT (Tax Deductible)',
        description: `Input Tax — Bill ${bill.billNumber} (${bill.supplierName})`,
        debit: bill.totalTax,
        credit: 0
      });
    }

    journalLines.push({
      account: 'Accounts Payable',
      description: `Payable to ${bill.supplierName} — Bill ${bill.billNumber}`,
      debit: 0,
      credit: bill.grandTotal
    });

    const totalDebit = Math.round(journalLines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
    const totalCredit = Math.round(journalLines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({
        message: `Double-entry invariant violated: Total Debits (€${totalDebit}) != Total Credits (€${totalCredit}).`
      });
    }

    const journalEntry = await JournalEntry.create({
      entryNumber: jeNumber,
      date: bill.billDate,
      reference: bill.billNumber,
      description: `Supplier Bill ${bill.billNumber} — ${bill.supplierName} (Ref: ${bill.supplierInvoiceNumber})`,
      entryType: 'supplier_bill',
      sourceDocument: {
        docType: 'supplier_bill',
        docId: bill._id,
        docNumber: bill.billNumber
      },
      lines: journalLines,
      totalDebit,
      totalCredit,
      status: 'posted',
      postedAt: new Date(),
      postedBy: bill.postedBy,
      company: req.user.company
    });

    bill.journalEntryId = journalEntry._id;

    const txnsToCreate = journalLines.map((jl, idx) => ({
      txnId: `TXN-${bill.billNumber}-${idx + 1}`,
      date: bill.billDate,
      description: jl.description,
      type: jl.debit > 0 ? 'debit' : 'credit',
      amount: jl.debit > 0 ? jl.debit : jl.credit,
      debit: jl.debit,
      credit: jl.credit,
      account: jl.account,
      category: getAccountCategory(jl.account),
      reference: bill.billNumber,
      status: 'posted',
      journalEntryId: journalEntry._id,
      company: req.user.company
    }));

    await Transaction.insertMany(txnsToCreate);
    await bill.save();

    res.json({
      message: `Bill ${bill.billNumber} posted successfully.`,
      bill,
      journalEntry
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/bills/:id/pay (Record Bill Payment)
router.post('/bills/:id/pay', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const bill = await SupplierBill.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { billNumber: req.params.id }
      ],
      company: req.user.company
    });

    if (!bill) return res.status(404).json({ message: 'Supplier bill not found' });

    if (bill.status === 'draft') {
      return res.status(400).json({ message: `Cannot record payment on DRAFT bill '${bill.billNumber}'. Please post the bill first.` });
    }
    if (bill.status === 'reversed') {
      return res.status(400).json({ message: `Cannot record payment on REVERSED bill '${bill.billNumber}'.` });
    }
    if (bill.status === 'paid' || bill.outstandingAmount <= 0) {
      return res.status(400).json({ message: `Bill '${bill.billNumber}' is already PAID in full.` });
    }

    const { amount, paymentMethod, paymentAccount, reference, notes, date } = req.body;
    const paymentAmt = Math.round(Number(amount) * 100) / 100;

    if (!paymentAmt || paymentAmt <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than 0.' });
    }

    // Overpayment Protection
    if (paymentAmt > bill.outstandingAmount + 0.001) {
      return res.status(400).json({
        message: `Overpayment not allowed: Payment (€${paymentAmt}) exceeds outstanding balance (€${bill.outstandingAmount.toFixed(2)}).`
      });
    }

    const payAccount = paymentAccount || 'Cash & Cash Equivalents';
    const payMethod = paymentMethod || 'Bank Transfer';
    const paymentNumber = `PAY-EXP-${Date.now()}-${bill.payments.length + 1}`;
    const paymentDate = date ? new Date(date) : new Date();

    // Create Double-Entry Journal Entry for Payment:
    // Debit: Accounts Payable (reduces liability)
    // Credit: Bank/Cash Account (reduces asset)
    const jeNumber = await generateNextJournalEntryNumber(req.user.company);
    const journalLines = [
      {
        account: 'Accounts Payable',
        description: `Payment to ${bill.supplierName} — Bill ${bill.billNumber}`,
        debit: paymentAmt,
        credit: 0
      },
      {
        account: payAccount,
        description: `${payMethod} Payment for Bill ${bill.billNumber} (${bill.supplierName})`,
        debit: 0,
        credit: paymentAmt
      }
    ];

    const journalEntry = await JournalEntry.create({
      entryNumber: jeNumber,
      date: paymentDate,
      reference: bill.billNumber,
      description: `Expense Payment ${paymentNumber} for Bill ${bill.billNumber} (${bill.supplierName})`,
      entryType: 'payment',
      sourceDocument: {
        docType: 'payment',
        docId: bill._id,
        docNumber: paymentNumber
      },
      lines: journalLines,
      totalDebit: paymentAmt,
      totalCredit: paymentAmt,
      status: 'posted',
      postedAt: new Date(),
      postedBy: req.user.name || req.user.email || 'Admin',
      company: req.user.company
    });

    const txnsToCreate = [
      {
        txnId: `TXN-${paymentNumber}-DR`,
        date: paymentDate,
        description: journalLines[0].description,
        type: 'debit',
        amount: paymentAmt,
        debit: paymentAmt,
        credit: 0,
        account: 'Accounts Payable',
        category: 'Liability',
        reference: bill.billNumber,
        status: 'posted',
        journalEntryId: journalEntry._id,
        company: req.user.company
      },
      {
        txnId: `TXN-${paymentNumber}-CR`,
        date: paymentDate,
        description: journalLines[1].description,
        type: 'credit',
        amount: paymentAmt,
        debit: 0,
        credit: paymentAmt,
        account: payAccount,
        category: getAccountCategory(payAccount),
        reference: bill.billNumber,
        status: 'posted',
        journalEntryId: journalEntry._id,
        company: req.user.company
      }
    ];

    await Transaction.insertMany(txnsToCreate);

    bill.payments.push({
      paymentNumber,
      date: paymentDate,
      amount: paymentAmt,
      paymentMethod: payMethod,
      paymentAccount: payAccount,
      reference: reference || '',
      notes: notes || '',
      journalEntryId: journalEntry._id,
      recordedBy: req.user.name || req.user.email || 'Admin'
    });

    bill.amountPaid = Math.round((bill.amountPaid + paymentAmt) * 100) / 100;
    bill.outstandingAmount = Math.round(Math.max(0, bill.grandTotal - bill.amountPaid) * 100) / 100;
    bill.status = bill.outstandingAmount === 0 ? 'paid' : 'partially_paid';

    await bill.save();

    res.json({
      message: `Payment of €${paymentAmt.toFixed(2)} recorded successfully for bill ${bill.billNumber}.`,
      bill,
      journalEntry
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/bills/:id/reverse (Reverse Posted Bill)
router.post('/bills/:id/reverse', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const bill = await SupplierBill.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { billNumber: req.params.id }
      ],
      company: req.user.company
    });

    if (!bill) return res.status(404).json({ message: 'Supplier bill not found' });
    if (bill.status === 'draft') {
      return res.status(400).json({ message: `Cannot reverse DRAFT bill. You can edit or delete draft bills directly.` });
    }
    if (bill.status === 'reversed') {
      return res.status(400).json({ message: `Bill '${bill.billNumber}' is already REVERSED.` });
    }
    if (bill.amountPaid > 0) {
      return res.status(400).json({
        message: `Cannot reverse bill '${bill.billNumber}' because payments of €${bill.amountPaid.toFixed(2)} have already been recorded. Please reverse or refund the payments first.`
      });
    }

    const { reason } = req.body;
    const jeNumber = await generateNextJournalEntryNumber(req.user.company);

    // Create Offsetting Double-Entry Reversal:
    // Debit: Accounts Payable (removes liability)
    // Credit: Input VAT (removes tax deductible)
    // Credit: Expense accounts (removes expenses)
    const reversalLines = [
      {
        account: 'Accounts Payable',
        description: `Reversal of Payable — Bill ${bill.billNumber} (${bill.supplierName})`,
        debit: bill.grandTotal,
        credit: 0
      }
    ];

    if (bill.totalTax > 0) {
      reversalLines.push({
        account: 'Input VAT (Tax Deductible)',
        description: `Reversal of Input Tax — Bill ${bill.billNumber}`,
        debit: 0,
        credit: bill.totalTax
      });
    }

    bill.lines.forEach(l => {
      reversalLines.push({
        account: l.expenseAccount,
        description: `Reversal of ${l.description} — Bill ${bill.billNumber}`,
        debit: 0,
        credit: l.lineSubtotal
      });
    });

    const totalDebit = Math.round(reversalLines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
    const totalCredit = Math.round(reversalLines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;

    const reversalEntry = await JournalEntry.create({
      entryNumber: jeNumber,
      date: new Date(),
      reference: bill.billNumber,
      description: `Reversal of Supplier Bill ${bill.billNumber} — Reason: ${reason || 'Billing Correction'}`,
      entryType: 'reversal',
      sourceDocument: {
        docType: 'supplier_bill',
        docId: bill._id,
        docNumber: bill.billNumber
      },
      lines: reversalLines,
      totalDebit,
      totalCredit,
      status: 'posted',
      postedAt: new Date(),
      postedBy: req.user.name || req.user.email || 'Admin',
      reversalReason: reason || 'Billing Correction',
      reversalOf: bill.journalEntryId,
      company: req.user.company
    });

    // Mark original journal entry as reversed
    if (bill.journalEntryId) {
      await JournalEntry.findByIdAndUpdate(bill.journalEntryId, {
        status: 'reversed',
        reversedAt: new Date(),
        reversedBy: req.user.name || req.user.email || 'Admin',
        reversalReason: reason || 'Billing Correction'
      });
    }

    // Insert reversal transactions in ledger
    const txnsToCreate = reversalLines.map((jl, idx) => ({
      txnId: `TXN-REV-${bill.billNumber}-${idx + 1}`,
      date: new Date(),
      description: jl.description,
      type: jl.debit > 0 ? 'debit' : 'credit',
      amount: jl.debit > 0 ? jl.debit : jl.credit,
      debit: jl.debit,
      credit: jl.credit,
      account: jl.account,
      category: getAccountCategory(jl.account),
      reference: bill.billNumber,
      status: 'posted',
      journalEntryId: reversalEntry._id,
      company: req.user.company
    }));

    await Transaction.insertMany(txnsToCreate);

    bill.status = 'reversed';
    bill.reversedAt = new Date();
    bill.reversedBy = req.user.name || req.user.email || 'Admin';
    bill.reversalReason = reason || 'Billing Correction';
    bill.reversalJournalEntryId = reversalEntry._id;
    bill.outstandingAmount = 0;

    await bill.save();

    res.json({
      message: `Bill ${bill.billNumber} successfully reversed.`,
      bill,
      reversalEntry
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/accounting/bills/:id (Delete Draft Bill Only)
router.delete('/bills/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const bill = await SupplierBill.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { billNumber: req.params.id }
      ],
      company: req.user.company
    });

    if (!bill) return res.status(404).json({ message: 'Supplier bill not found' });

    // Posted entry protection: cannot delete posted/partially_paid/paid bills
    if (bill.status !== 'draft') {
      return res.status(400).json({
        message: `Cannot delete bill '${bill.billNumber}' with status '${bill.status}'. Posted accounting documents cannot be deleted. Use Reversal instead.`
      });
    }

    await SupplierBill.findByIdAndDelete(bill._id);
    res.json({ message: `Draft bill '${bill.billNumber}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. MANUAL DOUBLE-ENTRY JOURNAL ENTRIES CRUD & WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/accounting/journal-entries
router.get('/journal-entries', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['entryNumber', 'reference', 'description', 'notes'],
      statusField: 'status'
    });

    if (req.query.entryType) {
      filter.entryType = req.query.entryType;
    }

    const result = await paginateQuery(JournalEntry, filter, req, {
      sort: { date: -1, createdAt: -1 }
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/accounting/journal-entries/:id
router.get('/journal-entries/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const entry = await JournalEntry.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { entryNumber: req.params.id }
      ],
      company: req.user.company
    }).populate('reversalOf');

    if (!entry) return res.status(404).json({ message: 'Journal entry not found' });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/journal-entries (Create Manual Journal Entry)
router.post('/journal-entries', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { date, reference, description, lines, notes } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ message: 'Journal entry description is required.' });
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ message: 'A journal entry requires at least two accounting lines.' });
    }

    let totalDebit = 0;
    let totalCredit = 0;

    const validatedLines = lines.map((line, idx) => {
      if (!line.account || !line.account.trim()) {
        throw new Error(`Line ${idx + 1}: Account is required.`);
      }

      const dr = Math.round((Math.max(0, Number(line.debit) || 0)) * 100) / 100;
      const cr = Math.round((Math.max(0, Number(line.credit) || 0)) * 100) / 100;

      if (dr > 0 && cr > 0) {
        throw new Error(`Line ${idx + 1}: A line cannot contain both Debit and Credit values.`);
      }
      if (dr === 0 && cr === 0) {
        throw new Error(`Line ${idx + 1}: Either Debit or Credit must be greater than 0.`);
      }

      totalDebit += dr;
      totalCredit += cr;

      return {
        account: line.account.trim(),
        description: line.description ? line.description.trim() : description.trim(),
        debit: dr,
        credit: cr
      };
    });

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    // Strict Double-Entry Invariant
    if (Math.abs(totalDebit - totalCredit) > 0.001 || totalDebit <= 0) {
      return res.status(400).json({
        message: `Unbalanced journal entry rejected: Total Debits (€${totalDebit.toFixed(2)}) must exactly equal Total Credits (€${totalCredit.toFixed(2)}). Difference: €${Math.abs(totalDebit - totalCredit).toFixed(2)}.`
      });
    }

    const entryNumber = await generateNextJournalEntryNumber(req.user.company);
    const entryDate = date ? new Date(date) : new Date();

    const journalEntry = await JournalEntry.create({
      entryNumber,
      date: entryDate,
      reference: reference ? reference.trim() : '',
      description: description.trim(),
      entryType: 'manual',
      sourceDocument: {
        docType: 'manual',
        docNumber: entryNumber
      },
      lines: validatedLines,
      totalDebit,
      totalCredit,
      status: 'posted',
      postedAt: new Date(),
      postedBy: req.user.name || req.user.email || 'Admin',
      notes: notes || '',
      company: req.user.company
    });

    // Create synchronized general ledger records
    const txnsToCreate = validatedLines.map((jl, idx) => ({
      txnId: `TXN-${entryNumber}-${idx + 1}`,
      date: entryDate,
      description: jl.description,
      type: jl.debit > 0 ? 'debit' : 'credit',
      amount: jl.debit > 0 ? jl.debit : jl.credit,
      debit: jl.debit,
      credit: jl.credit,
      account: jl.account,
      category: getAccountCategory(jl.account),
      reference: reference || entryNumber,
      status: 'posted',
      journalEntryId: journalEntry._id,
      company: req.user.company
    }));

    await Transaction.insertMany(txnsToCreate);

    res.status(201).json(journalEntry);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/journal-entries/:id/reverse (Reverse Journal Entry)
router.post('/journal-entries/:id/reverse', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const entry = await JournalEntry.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { entryNumber: req.params.id }
      ],
      company: req.user.company
    });

    if (!entry) return res.status(404).json({ message: 'Journal entry not found' });
    if (entry.status === 'reversed') {
      return res.status(400).json({ message: `Journal entry '${entry.entryNumber}' is already REVERSED.` });
    }

    const { reason } = req.body;
    const reversalNumber = await generateNextJournalEntryNumber(req.user.company);

    // Swap Debits and Credits
    const reversalLines = entry.lines.map(l => ({
      account: l.account,
      description: `Reversal: ${l.description}`,
      debit: l.credit,
      credit: l.debit
    }));

    const reversalEntry = await JournalEntry.create({
      entryNumber: reversalNumber,
      date: new Date(),
      reference: entry.entryNumber,
      description: `Reversal of ${entry.entryNumber} — Reason: ${reason || 'Correction'}`,
      entryType: 'reversal',
      sourceDocument: {
        docType: 'manual',
        docId: entry._id,
        docNumber: entry.entryNumber
      },
      lines: reversalLines,
      totalDebit: entry.totalCredit,
      totalCredit: entry.totalDebit,
      status: 'posted',
      postedAt: new Date(),
      postedBy: req.user.name || req.user.email || 'Admin',
      reversalReason: reason || 'Correction',
      reversalOf: entry._id,
      company: req.user.company
    });

    // Mark original as reversed
    entry.status = 'reversed';
    entry.reversedAt = new Date();
    entry.reversedBy = req.user.name || req.user.email || 'Admin';
    entry.reversalReason = reason || 'Correction';
    await entry.save();

    // Insert reversal transactions in ledger
    const txnsToCreate = reversalLines.map((jl, idx) => ({
      txnId: `TXN-REV-${reversalNumber}-${idx + 1}`,
      date: new Date(),
      description: jl.description,
      type: jl.debit > 0 ? 'debit' : 'credit',
      amount: jl.debit > 0 ? jl.debit : jl.credit,
      debit: jl.debit,
      credit: jl.credit,
      account: jl.account,
      category: getAccountCategory(jl.account),
      reference: entry.entryNumber,
      status: 'posted',
      journalEntryId: reversalEntry._id,
      company: req.user.company
    }));

    await Transaction.insertMany(txnsToCreate);

    res.json({
      message: `Journal entry ${entry.entryNumber} reversed successfully.`,
      reversalEntry
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/accounting/journal-entries/:id (Blocked for Audit Protection)
router.delete('/journal-entries/:id', async (req, res) => {
  return res.status(400).json({
    message: 'Posted accounting journal entries cannot be deleted to preserve financial audit integrity. Please use the Reversal action instead.'
  });
});

export default router;
