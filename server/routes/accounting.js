import express from 'express';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { protect, requireRole } from '../middleware/auth.js';
import { paginateQuery } from '../utils/pagination.js';
import { buildListFilter } from '../utils/listFilters.js';
import Transaction from '../models/Transaction.js';
import SupplierBill from '../models/SupplierBill.js';
import JournalEntry from '../models/JournalEntry.js';
import Supplier from '../models/Supplier.js';
import Counter from '../models/Counter.js';
import ChartOfAccount from '../models/ChartOfAccount.js';
import ChartOfAccountImportLog from '../models/ChartOfAccountImportLog.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';

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

async function generateNextImportLogNumber(companyId) {
  const currentYear = new Date().getFullYear();
  const counterId = `coa_import_${currentYear}_${companyId}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: counterId, company: companyId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `COA-IMP-${currentYear}-${String(counter.seq).padStart(4, '0')}`;
}

// ── Standard Spanish PGC Sample Fixture ──────────────────────────────────────
const STANDARD_SPANISH_PGC_FIXTURE = [
  { accountCode: "100", accountName: "Capital", accountType: "Equity", category: "Capital & Reserves", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "400", accountName: "Suppliers", accountType: "Liability", category: "Accounts Payable", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "400.000", accountName: "Supplier Accounts Group", accountType: "Liability", category: "Accounts Payable", parentAccountCode: "400", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "400.000.001", accountName: "Bag Supplier", accountType: "Liability", category: "Accounts Payable", parentAccountCode: "400.000", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "400.000.002", accountName: "Packaging Supplier", accountType: "Liability", category: "Accounts Payable", parentAccountCode: "400.000", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "410", accountName: "Creditors for Services", accountType: "Liability", category: "Accounts Payable", allowSubAccounts: true, isPostingAccount: true },
  { accountCode: "430", accountName: "Customers", accountType: "Asset", category: "Accounts Receivable", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "430.000.001", accountName: "Customer A", accountType: "Asset", category: "Accounts Receivable", parentAccountCode: "430", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "472", accountName: "Input VAT (Tax Deductible)", accountType: "Asset", category: "Tax Receivables", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "477", accountName: "Output VAT (Taxes Payable)", accountType: "Liability", category: "Tax Payables", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "572", accountName: "Bank Accounts", accountType: "Asset", category: "Cash & Cash Equivalents", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "572.000.001", accountName: "Banco Santander (Main Operating EUR)", accountType: "Asset", category: "Cash & Cash Equivalents", parentAccountCode: "572", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "600", accountName: "Purchases of Merchandise", accountType: "Expense", category: "Cost of Goods Sold", allowSubAccounts: true, isPostingAccount: true },
  { accountCode: "621", accountName: "Rent Expense", accountType: "Expense", category: "Operating Expense", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "628", accountName: "Utilities & Power", accountType: "Expense", category: "Operating Expense", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "624", accountName: "Logistics & Freight Expense", accountType: "Expense", category: "Operating Expense", allowSubAccounts: false, isPostingAccount: true },
  { accountCode: "700", accountName: "Sales Revenue", accountType: "Revenue", category: "Operating Revenue", allowSubAccounts: true, isPostingAccount: false },
  { accountCode: "700.000.001", accountName: "Product Sales", accountType: "Revenue", category: "Operating Revenue", parentAccountCode: "700", allowSubAccounts: false, isPostingAccount: true }
];

// Helper: Ensure base Chart of Accounts is initialized for company
async function ensureChartOfAccountsInitialized(companyId) {
  const count = await ChartOfAccount.countDocuments({ company: companyId });
  if (count > 0) return;

  const codeMap = {};
  for (const item of STANDARD_SPANISH_PGC_FIXTURE) {
    let parentId = null;
    let hierarchyLevel = 0;
    if (item.parentAccountCode && codeMap[item.parentAccountCode]) {
      parentId = codeMap[item.parentAccountCode]._id;
      hierarchyLevel = (codeMap[item.parentAccountCode].hierarchyLevel || 0) + 1;
    }

    const created = await ChartOfAccount.create({
      accountCode: item.accountCode,
      accountName: item.accountName,
      accountType: item.accountType,
      category: item.category,
      parentAccountId: parentId,
      parentAccountCode: item.parentAccountCode || '',
      hierarchyLevel,
      allowSubAccounts: item.allowSubAccounts !== undefined ? item.allowSubAccounts : true,
      isPostingAccount: item.isPostingAccount !== undefined ? item.isPostingAccount : true,
      company: companyId
    });
    codeMap[item.accountCode] = created;
  }
}

// ── Circular Hierarchy Check Helper ─────────────────────────────────────────
async function checkCircularHierarchy(accountId, proposedParentId, companyId) {
  if (!proposedParentId) return false;
  if (String(accountId) === String(proposedParentId)) return true;

  let currentParentId = proposedParentId;
  const visited = new Set([String(accountId)]);

  while (currentParentId) {
    if (visited.has(String(currentParentId))) return true;
    visited.add(String(currentParentId));

    const parent = await ChartOfAccount.findOne({ _id: currentParentId, company: companyId });
    if (!parent || !parent.parentAccountId) break;
    currentParentId = parent.parentAccountId;
  }
  return false;
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

function getAccountCategory(accountName) {
  if (/revenue|sales|income/i.test(accountName)) return 'Revenue';
  if (/expense|cost|utility|rent|fee|tax|freight|purchase/i.test(accountName)) return 'Expense';
  if (/payable|liability|debt|loan|vat payable/i.test(accountName)) return 'Liability';
  if (/equity|retained|capital/i.test(accountName)) return 'Equity';
  return 'Asset';
}

/**
 * Resolves per-company accounting configuration.
 * Bootstraps default config from CoA if not yet configured.
 * Returns config doc with accountId ObjectId refs for VAT, bank, AP accounts.
 */
async function resolveAccountingConfig(companyId, session = null) {
  let config = await CompanyAccountingConfig.findOne({ company: companyId });
  if (!config) {
    // Bootstrap from CoA — find standard Spanish PGC accounts
    const vatAccount = await ChartOfAccount.findOne({ company: companyId, accountCode: '472' });
    const bankAccount = await ChartOfAccount.findOne({ company: companyId, accountCode: '572.000.001' });
    const apAccount = await ChartOfAccount.findOne({ company: companyId, accountCode: '400' });
    const arAccount = await ChartOfAccount.findOne({ company: companyId, accountCode: '430' });

    const configData = {
      company: companyId,
      isBootstrapped: Boolean(vatAccount || bankAccount || apAccount),
      configuredBy: 'System'
    };
    if (vatAccount) {
      configData.defaultInputVATAccountId = vatAccount._id;
      configData.defaultInputVATAccountCode = vatAccount.accountCode;
      configData.defaultInputVATAccountName = vatAccount.accountName;
    }
    if (bankAccount) {
      configData.defaultBankAccountId = bankAccount._id;
      configData.defaultBankAccountCode = bankAccount.accountCode;
      configData.defaultBankAccountName = bankAccount.accountName;
    }
    if (apAccount) {
      configData.defaultAccountsPayableAccountId = apAccount._id;
      configData.defaultAccountsPayableAccountCode = apAccount.accountCode;
      configData.defaultAccountsPayableAccountName = apAccount.accountName;
    }
    if (arAccount) {
      configData.defaultAccountsReceivableAccountId = arAccount._id;
      configData.defaultAccountsReceivableAccountCode = arAccount.accountCode;
      configData.defaultAccountsReceivableAccountName = arAccount.accountName;
    }
    config = await CompanyAccountingConfig.findOneAndUpdate(
      { company: companyId },
      { $setOnInsert: configData },
      { upsert: true, new: true, session }
    );
  }
  return config;
}

/**
 * Enriches a journal line with accountId, accountCodeSnapshot, accountNameSnapshot
 * by looking up the ChartOfAccount for the company.
 */
async function enrichJournalLine(line, companyId, session = null) {
  if (!line.account) return line;
  const acct = await ChartOfAccount.findOne({
    company: companyId,
    $or: [
      { accountName: line.account },
      { accountCode: line.account },
      { accountName: { $regex: new RegExp(line.account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } }
    ]
  }, null, session ? { session } : {});
  return {
    ...line,
    accountId: acct ? acct._id : null,
    accountCodeSnapshot: acct ? acct.accountCode : '',
    accountNameSnapshot: acct ? acct.accountName : line.account
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. ACCOUNTING OVERVIEW & CHART OF ACCOUNTS SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    await ensureChartOfAccountsInitialized(req.user.company);

    const result = await paginateQuery(Transaction, { company: req.user.company }, req, {
      sort: { date: -1, createdAt: -1 }
    });

    const coaList = await ChartOfAccount.find({ company: req.user.company }).sort({ accountCode: 1 });
    const allTxns = await Transaction.find({ company: req.user.company, status: { $ne: 'reversed' } });

    const accountMap = {};
    coaList.forEach(a => {
      accountMap[a.accountName] = {
        _id: a._id,
        accountCode: a.accountCode,
        name: a.accountName,
        category: a.category || getAccountCategory(a.accountName),
        accountType: a.accountType,
        isPostingAccount: a.isPostingAccount,
        hierarchyLevel: a.hierarchyLevel,
        allowSubAccounts: a.allowSubAccounts,
        balance: 0,
        debitTotal: 0,
        creditTotal: 0,
        change: 0
      };
    });

    let totalRevenue = 0;
    let totalExpenses = 0;
    let accountsPayable = 0;
    let accountsReceivable = 0;

    allTxns.forEach(txn => {
      const acct = txn.account || 'Uncategorized Account';
      if (!accountMap[acct]) {
        accountMap[acct] = {
          name: acct,
          accountCode: txn.reference || '',
          category: txn.category || getAccountCategory(acct),
          accountType: txn.category === 'Expense' ? 'Expense' : txn.category === 'Revenue' ? 'Revenue' : 'Asset',
          isPostingAccount: true,
          balance: 0,
          debitTotal: 0,
          creditTotal: 0,
          change: 0
        };
      }

      const amt = Number(txn.amount) || 0;
      const isDebit = txn.type === 'debit' || (txn.debit > 0 && txn.credit === 0);

      if (isDebit) {
        accountMap[acct].debitTotal += amt;
      } else {
        accountMap[acct].creditTotal += amt;
      }

      const cat = accountMap[acct].category || accountMap[acct].accountType;
      if (cat === 'Asset' || cat === 'Expense') {
        accountMap[acct].balance = accountMap[acct].debitTotal - accountMap[acct].creditTotal;
      } else {
        accountMap[acct].balance = accountMap[acct].creditTotal - accountMap[acct].debitTotal;
      }
    });

    Object.values(accountMap).forEach(acc => {
      if (acc.accountType === 'Revenue' || acc.category === 'Revenue') totalRevenue += acc.balance;
      if (acc.accountType === 'Expense' || acc.category === 'Expense') totalExpenses += acc.balance;
      if (acc.name === 'Accounts Payable' || acc.category === 'Accounts Payable') accountsPayable += acc.balance;
      if (acc.name === 'Accounts Receivable' || acc.category === 'Accounts Receivable') accountsReceivable += acc.balance;
    });

    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round(((netProfit / totalRevenue) * 100) * 10) / 10 : 0;

    const accounts = Object.values(accountMap).sort((a, b) => {
      return (a.accountCode || '').localeCompare(b.accountCode || '');
    });

    res.json({
      transactions: result,
      accounts,
      stats: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        profitMargin,
        accountsPayable: Math.round(accountsPayable * 100) / 100,
        accountsReceivable: Math.round(accountsReceivable * 100) / 100
      }
    });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. CHART OF ACCOUNTS HIERARCHY CRUD & APIS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/accounting/accounts (List all accounts with hierarchy support)
router.get('/accounts', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    await ensureChartOfAccountsInitialized(req.user.company);

    const filter = { company: req.user.company };
    if (req.query.postingOnly === 'true') {
      filter.isPostingAccount = true;
    }
    if (req.query.search) {
      const q = req.query.search.trim();
      filter.$or = [
        { accountCode: { $regex: q, $options: 'i' } },
        { accountName: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } }
      ];
    }

    const accounts = await ChartOfAccount.find(filter)
      .populate('parentAccountId', 'accountCode accountName')
      .populate('supplierId', 'name email taxId')
      .sort({ accountCode: 1 });

    // Calculate live balances for each account from non-reversed transactions
    const allTxns = await Transaction.find({ company: req.user.company, status: { $ne: 'reversed' } });
    const balanceMap = {};
    allTxns.forEach(txn => {
      const acct = txn.account;
      if (!balanceMap[acct]) balanceMap[acct] = { debit: 0, credit: 0 };
      if (txn.type === 'debit' || txn.debit > 0) balanceMap[acct].debit += (txn.debit || txn.amount || 0);
      if (txn.type === 'credit' || txn.credit > 0) balanceMap[acct].credit += (txn.credit || txn.amount || 0);
    });

    const enriched = accounts.map(a => {
      const obj = a.toObject();
      const b = balanceMap[a.accountName] || balanceMap[a.accountCode] || { debit: 0, credit: 0 };
      const isNormalDebit = a.accountType === 'Asset' || a.accountType === 'Expense';
      obj.balance = isNormalDebit ? Math.round((b.debit - b.credit) * 100) / 100 : Math.round((b.credit - b.debit) * 100) / 100;
      obj.debitTotal = Math.round(b.debit * 100) / 100;
      obj.creditTotal = Math.round(b.credit * 100) / 100;
      return obj;
    });

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/accounts/next-code (Suggest next child account code)
router.post('/accounts/next-code', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { parentAccountId, parentAccountCode } = req.body;
    let parent = null;

    if (parentAccountId && mongoose.isValidObjectId(parentAccountId)) {
      parent = await ChartOfAccount.findOne({ _id: parentAccountId, company: req.user.company });
    } else if (parentAccountCode) {
      parent = await ChartOfAccount.findOne({ accountCode: parentAccountCode.trim(), company: req.user.company });
    }

    if (!parent) {
      return res.status(400).json({ message: 'Valid parent account is required to generate next sub-account code.' });
    }

    const pCode = parent.accountCode;
    // Find all direct children under parent
    const escapedParent = pCode.replace(/\./g, '\\.');
    const regex = new RegExp(`^${escapedParent}\\.([^.]+)$`);

    const children = await ChartOfAccount.find({
      company: req.user.company,
      accountCode: { $regex: regex }
    }).sort({ accountCode: 1 });

    let maxSeq = 0;
    let hasNumeric = false;
    children.forEach(c => {
      const suffix = c.accountCode.substring(pCode.length + 1);
      const num = parseInt(suffix, 10);
      if (!isNaN(num)) {
        hasNumeric = true;
        if (num > maxSeq) maxSeq = num;
      }
    });

    let suggestedCode = '';
    if (parent.hierarchyLevel === 0) {
      // Level 0 -> e.g. 400 -> suggested 400.000 or 400.001
      suggestedCode = `${pCode}.${String(maxSeq + 1).padStart(3, '0')}`;
      if (children.length === 0) suggestedCode = `${pCode}.000`;
    } else {
      // Level 1+ -> e.g. 400.000 -> 400.000.001
      suggestedCode = `${pCode}.${String(maxSeq + 1).padStart(3, '0')}`;
    }

    res.json({
      parentCode: pCode,
      parentName: parent.accountName,
      suggestedCode,
      hierarchyLevel: parent.hierarchyLevel + 1,
      accountType: parent.accountType,
      category: parent.category
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/accounts (Create Account or Sub-Account)
router.post('/accounts', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const {
      accountCode,
      accountName,
      accountType,
      category,
      parentAccountId,
      parentAccountCode,
      allowSubAccounts,
      isPostingAccount,
      description,
      supplierId
    } = req.body;

    if (!accountCode || !accountCode.trim()) {
      return res.status(400).json({ message: 'Account code is required.' });
    }
    if (!accountName || !accountName.trim()) {
      return res.status(400).json({ message: 'Account name is required.' });
    }
    if (!accountType || !['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'].includes(accountType)) {
      return res.status(400).json({ message: 'Valid account type (Asset, Liability, Equity, Revenue, Expense) is required.' });
    }

    const trimmedCode = accountCode.trim();
    const existing = await ChartOfAccount.findOne({ company: req.user.company, accountCode: trimmedCode });
    if (existing) {
      return res.status(400).json({ message: `Account code '${trimmedCode}' already exists in your Chart of Accounts.` });
    }

    let resolvedParentId = null;
    let resolvedParentCode = '';
    let hierarchyLevel = 0;

    if (parentAccountId && mongoose.isValidObjectId(parentAccountId)) {
      const parentDoc = await ChartOfAccount.findOne({ _id: parentAccountId, company: req.user.company });
      if (!parentDoc) return res.status(404).json({ message: 'Specified parent account does not exist.' });
      if (parentDoc.allowSubAccounts === false) {
        return res.status(400).json({ message: `Parent account '${parentDoc.accountCode} - ${parentDoc.accountName}' does not allow sub-accounts.` });
      }
      resolvedParentId = parentDoc._id;
      resolvedParentCode = parentDoc.accountCode;
      hierarchyLevel = (parentDoc.hierarchyLevel || 0) + 1;
    } else if (parentAccountCode && parentAccountCode.trim()) {
      const parentDoc = await ChartOfAccount.findOne({ accountCode: parentAccountCode.trim(), company: req.user.company });
      if (!parentDoc) return res.status(404).json({ message: `Parent account with code '${parentAccountCode.trim()}' does not exist.` });
      if (parentDoc.allowSubAccounts === false) {
        return res.status(400).json({ message: `Parent account '${parentDoc.accountCode} - ${parentDoc.accountName}' does not allow sub-accounts.` });
      }
      resolvedParentId = parentDoc._id;
      resolvedParentCode = parentDoc.accountCode;
      hierarchyLevel = (parentDoc.hierarchyLevel || 0) + 1;
    }

    const account = await ChartOfAccount.create({
      accountCode: trimmedCode,
      accountName: accountName.trim(),
      accountType,
      category: category ? category.trim() : getAccountCategory(accountName),
      parentAccountId: resolvedParentId,
      parentAccountCode: resolvedParentCode,
      hierarchyLevel,
      allowSubAccounts: allowSubAccounts !== undefined ? Boolean(allowSubAccounts) : true,
      isPostingAccount: isPostingAccount !== undefined ? Boolean(isPostingAccount) : true,
      description: description ? description.trim() : '',
      supplierId: supplierId && mongoose.isValidObjectId(supplierId) ? supplierId : null,
      company: req.user.company
    });

    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/accounting/accounts/:id (Update Account)
router.put('/accounts/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const account = await ChartOfAccount.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { accountCode: req.params.id }
      ],
      company: req.user.company
    });

    if (!account) return res.status(404).json({ message: 'Account not found.' });

    const {
      accountName,
      accountType,
      category,
      parentAccountId,
      allowSubAccounts,
      isPostingAccount,
      description,
      active
    } = req.body;

    if (parentAccountId !== undefined) {
      if (parentAccountId) {
        const isCycle = await checkCircularHierarchy(account._id, parentAccountId, req.user.company);
        if (isCycle) {
          return res.status(400).json({ message: 'Circular hierarchy detected: An account cannot become its own ancestor or descendant.' });
        }
        const parentDoc = await ChartOfAccount.findOne({ _id: parentAccountId, company: req.user.company });
        if (!parentDoc) return res.status(404).json({ message: 'Specified parent account not found.' });
        account.parentAccountId = parentDoc._id;
        account.parentAccountCode = parentDoc.accountCode;
        account.hierarchyLevel = (parentDoc.hierarchyLevel || 0) + 1;
      } else {
        account.parentAccountId = null;
        account.parentAccountCode = '';
        account.hierarchyLevel = 0;
      }
    }

    if (accountName !== undefined) account.accountName = accountName.trim();
    if (accountType !== undefined) account.accountType = accountType;
    if (category !== undefined) account.category = category.trim();
    if (allowSubAccounts !== undefined) account.allowSubAccounts = Boolean(allowSubAccounts);
    if (isPostingAccount !== undefined) account.isPostingAccount = Boolean(isPostingAccount);
    if (description !== undefined) account.description = description.trim();
    if (active !== undefined) account.active = Boolean(active);

    await account.save();
    res.json(account);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/accounting/accounts/:id
router.delete('/accounts/:id', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const account = await ChartOfAccount.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : new mongoose.Types.ObjectId() },
        { accountCode: req.params.id }
      ],
      company: req.user.company
    });

    if (!account) return res.status(404).json({ message: 'Account not found.' });

    // Check for child sub-accounts
    const childCount = await ChartOfAccount.countDocuments({ parentAccountId: account._id, company: req.user.company });
    if (childCount > 0) {
      return res.status(400).json({ message: `Cannot delete account '${account.accountCode} - ${account.accountName}' because it has ${childCount} active child sub-accounts. Please delete or reassign child accounts first.` });
    }

    // Check for ledger transaction postings
    const txnCount = await Transaction.countDocuments({
      company: req.user.company,
      $or: [{ account: account.accountName }, { account: account.accountCode }]
    });
    if (txnCount > 0) {
      return res.status(400).json({ message: `Cannot delete account '${account.accountCode}' because it has ${txnCount} posted ledger transactions. Archive or deactivate the account instead.` });
    }

    await ChartOfAccount.findByIdAndDelete(account._id);
    res.json({ message: `Account '${account.accountCode} - ${account.accountName}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. EXCEL / CSV CHART OF ACCOUNTS IMPORT PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/v1/accounting/accounts/import/preview (Validate & Dry Run)
router.post('/accounts/import/preview', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { rows, columnMapping } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'No rows provided for import preview.' });
    }

    const mapping = columnMapping || {
      accountCode: 'Account Code',
      accountName: 'Account Name',
      accountType: 'Account Type',
      category: 'Category',
      parentAccountCode: 'Parent Account',
      allowSubAccounts: 'Allow Sub-Accounts',
      isPostingAccount: 'Posting Account'
    };

    const existingAccounts = await ChartOfAccount.find({ company: req.user.company });
    const existingCodeMap = new Map(existingAccounts.map(a => [a.accountCode, a]));

    const previewRows = [];
    const sheetCodes = new Set();
    let validCount = 0;
    let invalidCount = 0;
    let newCount = 0;
    let updateCount = 0;
    const errors = [];

    rows.forEach((r, idx) => {
      const rawCode = r[mapping.accountCode] || r['Code'] || r['accountCode'] || r['Codigo'] || '';
      const rawName = r[mapping.accountName] || r['Name'] || r['accountName'] || r['Descripcion'] || '';
      const rawType = r[mapping.accountType] || r['Type'] || r['accountType'] || r['Tipo'] || 'Asset';
      const rawParent = r[mapping.parentAccountCode] || r['Parent'] || r['parentAccountCode'] || r['Padre'] || '';
      const rawAllowSub = r[mapping.allowSubAccounts] || r['Allow Sub-Accounts'] || r['allowSubAccounts'] || 'Yes';
      const rawPosting = r[mapping.isPostingAccount] || r['Posting Account'] || r['isPostingAccount'] || 'Yes';

      const code = String(rawCode).trim();
      const name = String(rawName).trim();
      let type = String(rawType).trim();
      const parentCode = String(rawParent).trim();

      // Normalize Account Type
      if (/asset|activo/i.test(type)) type = 'Asset';
      else if (/liability|pasivo/i.test(type)) type = 'Liability';
      else if (/equity|patrimonio|neto/i.test(type)) type = 'Equity';
      else if (/revenue|ingreso|ventas/i.test(type)) type = 'Revenue';
      else if (/expense|gasto|compras/i.test(type)) type = 'Expense';
      else type = 'Asset';

      const allowSubAccounts = /yes|true|1|si/i.test(String(rawAllowSub));
      const isPostingAccount = /yes|true|1|si/i.test(String(rawPosting));

      const rowResult = {
        rowNumber: idx + 1,
        accountCode: code,
        accountName: name,
        accountType: type,
        parentAccountCode: parentCode,
        allowSubAccounts,
        isPostingAccount,
        status: 'VALID',
        action: 'NEW',
        issues: []
      };

      if (!code) {
        rowResult.status = 'INVALID';
        rowResult.issues.push('Missing Account Code');
      }
      if (!name) {
        rowResult.status = 'INVALID';
        rowResult.issues.push('Missing Account Name');
      }

      if (code && sheetCodes.has(code)) {
        rowResult.status = 'INVALID';
        rowResult.issues.push(`Duplicate Account Code in spreadsheet: '${code}'`);
      }
      if (code) sheetCodes.add(code);

      if (parentCode && parentCode === code) {
        rowResult.status = 'INVALID';
        rowResult.issues.push('Account cannot be its own parent.');
      }

      if (rowResult.status === 'VALID') {
        validCount++;
        if (existingCodeMap.has(code)) {
          rowResult.action = 'UPDATE';
          updateCount++;
        } else {
          rowResult.action = 'NEW';
          newCount++;
        }
      } else {
        invalidCount++;
        errors.push({ rowNumber: idx + 1, accountCode: code, reason: rowResult.issues.join('; ') });
      }

      previewRows.push(rowResult);
    });

    res.json({
      totalRows: rows.length,
      validCount,
      invalidCount,
      newCount,
      updateCount,
      previewRows: previewRows.slice(0, 100), // Preview sample
      errors
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/accounts/import/execute (Safe Batch Execution)
router.post('/accounts/import/execute', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { rows, columnMapping, importMode, fileName } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'No rows provided for import.' });
    }

    const mode = importMode || 'create_new_only'; // 'create_new_only' or 'update_existing'
    const mapping = columnMapping || {
      accountCode: 'Account Code',
      accountName: 'Account Name',
      accountType: 'Account Type',
      category: 'Category',
      parentAccountCode: 'Parent Account',
      allowSubAccounts: 'Allow Sub-Accounts',
      isPostingAccount: 'Posting Account'
    };

    const importId = await generateNextImportLogNumber(req.user.company);
    const existingAccounts = await ChartOfAccount.find({ company: req.user.company });
    const codeToAccountMap = new Map(existingAccounts.map(a => [a.accountCode, a]));

    // Clean and normalize incoming accounts
    const parsedAccounts = [];
    rows.forEach((r, idx) => {
      const rawCode = r[mapping.accountCode] || r['Code'] || r['accountCode'] || r['Codigo'] || '';
      const rawName = r[mapping.accountName] || r['Name'] || r['accountName'] || r['Descripcion'] || '';
      const rawType = r[mapping.accountType] || r['Type'] || r['accountType'] || r['Tipo'] || 'Asset';
      const rawParent = r[mapping.parentAccountCode] || r['Parent'] || r['parentAccountCode'] || r['Padre'] || '';
      const rawAllowSub = r[mapping.allowSubAccounts] || r['Allow Sub-Accounts'] || r['allowSubAccounts'] || 'Yes';
      const rawPosting = r[mapping.isPostingAccount] || r['Posting Account'] || r['isPostingAccount'] || 'Yes';

      const code = String(rawCode).trim();
      const name = String(rawName).trim();
      let type = String(rawType).trim();
      const parentCode = String(rawParent).trim();

      if (/asset|activo/i.test(type)) type = 'Asset';
      else if (/liability|pasivo/i.test(type)) type = 'Liability';
      else if (/equity|patrimonio|neto/i.test(type)) type = 'Equity';
      else if (/revenue|ingreso|ventas/i.test(type)) type = 'Revenue';
      else if (/expense|gasto|compras/i.test(type)) type = 'Expense';
      else type = 'Asset';

      if (code && name) {
        parsedAccounts.push({
          rowNumber: idx + 1,
          accountCode: code,
          accountName: name,
          accountType: type,
          category: getAccountCategory(name),
          parentAccountCode: parentCode,
          allowSubAccounts: /yes|true|1|si/i.test(String(rawAllowSub)),
          isPostingAccount: /yes|true|1|si/i.test(String(rawPosting))
        });
      }
    });

    // Dependency topological sorting:
    // Sort accounts so accounts with fewer segments / no parent come before child accounts
    parsedAccounts.sort((a, b) => {
      const aSegments = (a.accountCode.match(/\./g) || []).length;
      const bSegments = (b.accountCode.match(/\./g) || []).length;
      if (aSegments !== bSegments) return aSegments - bSegments;
      return a.accountCode.localeCompare(b.accountCode);
    });

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const errorDetails = [];

    for (const item of parsedAccounts) {
      try {
        const existing = codeToAccountMap.get(item.accountCode);

        if (existing) {
          if (mode === 'create_new_only') {
            skippedCount++;
            continue;
          }
          // Update existing
          existing.accountName = item.accountName;
          existing.accountType = item.accountType;
          existing.category = item.category;
          existing.allowSubAccounts = item.allowSubAccounts;
          existing.isPostingAccount = item.isPostingAccount;
          await existing.save();
          updatedCount++;
        } else {
          // Resolve parent
          let parentId = null;
          let level = 0;
          if (item.parentAccountCode) {
            const parentDoc = codeToAccountMap.get(item.parentAccountCode);
            if (parentDoc) {
              parentId = parentDoc._id;
              level = (parentDoc.hierarchyLevel || 0) + 1;
            }
          }

          const created = await ChartOfAccount.create({
            accountCode: item.accountCode,
            accountName: item.accountName,
            accountType: item.accountType,
            category: item.category,
            parentAccountId: parentId,
            parentAccountCode: item.parentAccountCode,
            hierarchyLevel: level,
            allowSubAccounts: item.allowSubAccounts,
            isPostingAccount: item.isPostingAccount,
            company: req.user.company
          });

          codeToAccountMap.set(created.accountCode, created);
          createdCount++;
        }
      } catch (err) {
        failedCount++;
        errorDetails.push({
          rowNumber: item.rowNumber,
          accountCode: item.accountCode,
          reason: err.message || 'Database error during insertion'
        });
      }
    }

    // Persist Import Audit Log
    const log = await ChartOfAccountImportLog.create({
      importId,
      fileName: fileName || 'chart_of_accounts.xlsx',
      importMode: mode,
      totalRows: rows.length,
      createdCount,
      updatedCount,
      skippedCount,
      failedCount,
      errorDetails,
      importedBy: req.user.name || req.user.email || 'Admin',
      company: req.user.company
    });

    res.status(201).json({
      importId,
      totalRows: rows.length,
      createdCount,
      updatedCount,
      skippedCount,
      failedCount,
      log
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/accounting/accounts/import/history
router.get('/accounts/import/history', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const logs = await ChartOfAccountImportLog.find({ company: req.user.company }).sort({ createdAt: -1 }).limit(50);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. SUPPLIER BILLS & RECEIVED INVOICES
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

// POST /api/v1/accounting/bills (Create Supplier Bill — Atomic Transaction)
router.post('/bills', async (req, res, next) => {
  const session = await mongoose.startSession();
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

    // Validate expense accounts are valid posting accounts (pre-flight, before transaction)
    for (const l of lines || []) {
      const expAcct = await ChartOfAccount.findOne({
        company: req.user.company,
        $or: [{ accountName: l.expenseAccount }, { accountCode: l.expenseAccount }]
      });
      if (expAcct && expAcct.isPostingAccount === false) {
        return res.status(400).json({
          message: `Account '${expAcct.accountCode} - ${expAcct.accountName}' is a grouping account and cannot receive transaction postings. Please select a valid posting account.`
        });
      }
    }

    // Duplicate Supplier Invoice Protection (pre-flight, before transaction)
    const duplicate = await SupplierBill.findOne({
      company: req.user.company,
      supplierId: supplier._id,
      supplierInvoiceNumber: { $regex: new RegExp(`^${supplierInvoiceNumber.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      status: { $ne: 'reversed' }
    });
    if (duplicate) {
      return res.status(400).json({
        message: `Supplier Invoice '${supplierInvoiceNumber.trim()}' already exists for supplier '${supplier.name}' (Bill ${duplicate.billNumber}).`
      });
    }

    const calcResult = calculateSupplierBill(lines);
    const initialStatus = requestedStatus === 'posted' ? 'posted' : 'draft';

    // Pre-flight double-entry check for posted bills
    if (initialStatus === 'posted') {
      const preflightDebit = calcResult.lines.reduce((s, l) => s + l.lineSubtotal, 0) + (calcResult.totalTax > 0 ? calcResult.totalTax : 0);
      const preflightCredit = calcResult.grandTotal;
      if (Math.abs(Math.round(preflightDebit * 100) / 100 - Math.round(preflightCredit * 100) / 100) > 0.01) {
        return res.status(400).json({
          message: `Double-entry invariant violated: Total Debits (€${preflightDebit.toFixed(2)}) must equal Total Credits (€${preflightCredit.toFixed(2)}).`
        });
      }
    }

    let savedBill;
    await session.withTransaction(async () => {
      const billNumber = await generateNextBillNumber(req.user.company, session);
      const acctConfig = await resolveAccountingConfig(req.user.company, session);

      const bill = new SupplierBill({
        billNumber,
        supplierId: supplier._id,
        supplierName: supplier.name,
        supplierTaxId: supplier.taxId || '',
        supplierEmail: supplier.email || '',
        supplierInvoiceNumber: supplierInvoiceNumber.trim(),
        billDate: billDate ? new Date(billDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        paymentTerms: paymentTerms || supplier.paymentInfo?.defaultPaymentTerms || 'Net 30',
        currency: 'EUR',
        lines: calcResult.lines,
        subtotal: calcResult.subtotal,
        discountTotal: calcResult.discountTotal,
        totalTax: calcResult.totalTax,
        grandTotal: calcResult.grandTotal,
        taxBreakdown: calcResult.taxBreakdown,
        amountPaid: 0,
        outstandingAmount: calcResult.grandTotal,
        status: initialStatus,
        postedAt: initialStatus === 'posted' ? new Date() : undefined,
        postedBy: initialStatus === 'posted' ? (req.user.name || req.user.email || 'Admin') : undefined,
        notes: notes || '',
        company: req.user.company
      });

      await bill.save({ session });

      if (initialStatus === 'posted') {
        const jeNumber = await generateNextJournalEntryNumber(req.user.company, session);
        const rawJournalLines = [];

        // Debits: Expense accounts
        for (const l of calcResult.lines) {
          rawJournalLines.push(await enrichJournalLine({
            account: l.expenseAccount,
            description: `${l.description} — Bill ${billNumber} (${supplier.name})`,
            debit: l.lineSubtotal,
            credit: 0
          }, req.user.company, session));
        }

        // Debit: Input VAT — resolved from company accounting config (not hardcoded)
        if (calcResult.totalTax > 0) {
          const vatLabel = acctConfig.defaultInputVATAccountCode
            ? `${acctConfig.defaultInputVATAccountCode} - ${acctConfig.defaultInputVATAccountName}`
            : acctConfig.defaultInputVATAccountName || 'Input VAT (Tax Deductible)';
          rawJournalLines.push({
            account: vatLabel,
            accountId: acctConfig.defaultInputVATAccountId || null,
            accountCodeSnapshot: acctConfig.defaultInputVATAccountCode || '',
            accountNameSnapshot: acctConfig.defaultInputVATAccountName || 'Input VAT (Tax Deductible)',
            description: `Input Tax — Bill ${billNumber} (${supplier.name})`,
            debit: calcResult.totalTax,
            credit: 0
          });
        }

        // Credit: Supplier-specific liability account or company default AP
        const supplierAccountLabel = supplier.accountingInfo?.accountCode
          ? `${supplier.accountingInfo.accountCode} - ${supplier.accountingInfo.accountName || supplier.name}`
          : (acctConfig.defaultAccountsPayableAccountCode
              ? `${acctConfig.defaultAccountsPayableAccountCode} - ${acctConfig.defaultAccountsPayableAccountName}`
              : 'Accounts Payable');
        rawJournalLines.push(await enrichJournalLine({
          account: supplierAccountLabel,
          description: `Payable to ${supplier.name} — Bill ${billNumber}`,
          debit: 0,
          credit: calcResult.grandTotal
        }, req.user.company, session));

        const totalDebit = Math.round(rawJournalLines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
        const totalCredit = Math.round(rawJournalLines.reduce((s, l) => s + l.credit, 0) * 100) / 100;

        const journalEntry = await JournalEntry.create([{
          entryNumber: jeNumber,
          date: bill.billDate,
          reference: billNumber,
          description: `Supplier Bill ${billNumber} — ${supplier.name} (Ref: ${supplierInvoiceNumber.trim()})`,
          entryType: 'supplier_bill',
          sourceDocument: { docType: 'supplier_bill', docId: bill._id, docNumber: billNumber },
          lines: rawJournalLines,
          totalDebit,
          totalCredit,
          status: 'posted',
          postedAt: new Date(),
          postedBy: bill.postedBy,
          company: req.user.company
        }], { session });

        bill.journalEntryId = journalEntry[0]._id;
        await bill.save({ session });

        const txnsToCreate = rawJournalLines.map((jl, idx) => ({
          txnId: `TXN-${billNumber}-${idx + 1}`,
          date: bill.billDate,
          description: jl.description,
          type: jl.debit > 0 ? 'debit' : 'credit',
          amount: jl.debit > 0 ? jl.debit : jl.credit,
          debit: jl.debit,
          credit: jl.credit,
          account: jl.account,
          accountId: jl.accountId || null,
          accountCodeSnapshot: jl.accountCodeSnapshot || '',
          accountNameSnapshot: jl.accountNameSnapshot || jl.account,
          category: getAccountCategory(jl.account),
          reference: billNumber,
          status: 'posted',
          journalEntryId: journalEntry[0]._id,
          company: req.user.company
        }));
        await Transaction.insertMany(txnsToCreate, { session });
      }

      savedBill = bill;
    });

    res.status(201).json(savedBill);
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// POST /api/v1/accounting/bills/:id/post (Post Draft Bill — Atomic Transaction)
router.post('/bills/:id/post', async (req, res, next) => {
  const session = await mongoose.startSession();
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

    const supplier = await Supplier.findOne({ _id: bill.supplierId, company: req.user.company });
    const acctConfig = await resolveAccountingConfig(req.user.company);

    await session.withTransaction(async () => {
      const jeNumber = await generateNextJournalEntryNumber(req.user.company, session);
      const rawJournalLines = [];

      for (const l of bill.lines) {
        rawJournalLines.push(await enrichJournalLine({
          account: l.expenseAccount,
          description: `${l.description} — Bill ${bill.billNumber} (${bill.supplierName})`,
          debit: l.lineSubtotal,
          credit: 0
        }, req.user.company, session));
      }

      if (bill.totalTax > 0) {
        const vatLabel = acctConfig.defaultInputVATAccountCode
          ? `${acctConfig.defaultInputVATAccountCode} - ${acctConfig.defaultInputVATAccountName}`
          : 'Input VAT (Tax Deductible)';
        rawJournalLines.push({
          account: vatLabel,
          accountId: acctConfig.defaultInputVATAccountId || null,
          accountCodeSnapshot: acctConfig.defaultInputVATAccountCode || '',
          accountNameSnapshot: acctConfig.defaultInputVATAccountName || 'Input VAT (Tax Deductible)',
          description: `Input Tax — Bill ${bill.billNumber} (${bill.supplierName})`,
          debit: bill.totalTax,
          credit: 0
        });
      }

      const supplierAccountLabel = supplier?.accountingInfo?.accountCode
        ? `${supplier.accountingInfo.accountCode} - ${supplier.accountingInfo.accountName || bill.supplierName}`
        : (acctConfig.defaultAccountsPayableAccountCode
            ? `${acctConfig.defaultAccountsPayableAccountCode} - ${acctConfig.defaultAccountsPayableAccountName}`
            : 'Accounts Payable');
      rawJournalLines.push(await enrichJournalLine({
        account: supplierAccountLabel,
        description: `Payable to ${bill.supplierName} — Bill ${bill.billNumber}`,
        debit: 0,
        credit: bill.grandTotal
      }, req.user.company, session));

      const totalDebit = Math.round(rawJournalLines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
      const totalCredit = Math.round(rawJournalLines.reduce((s, l) => s + l.credit, 0) * 100) / 100;

      const journalEntry = await JournalEntry.create([{
        entryNumber: jeNumber,
        date: bill.billDate,
        reference: bill.billNumber,
        description: `Supplier Bill ${bill.billNumber} — ${bill.supplierName} (Ref: ${bill.supplierInvoiceNumber})`,
        entryType: 'supplier_bill',
        sourceDocument: { docType: 'supplier_bill', docId: bill._id, docNumber: bill.billNumber },
        lines: rawJournalLines,
        totalDebit,
        totalCredit,
        status: 'posted',
        postedAt: new Date(),
        postedBy: req.user.name || req.user.email || 'Admin',
        company: req.user.company
      }], { session });

      bill.status = 'posted';
      bill.postedAt = new Date();
      bill.postedBy = req.user.name || req.user.email || 'Admin';
      bill.journalEntryId = journalEntry[0]._id;
      await bill.save({ session });

      const txnsToCreate = rawJournalLines.map((jl, idx) => ({
        txnId: `TXN-${bill.billNumber}-${idx + 1}`,
        date: bill.billDate,
        description: jl.description,
        type: jl.debit > 0 ? 'debit' : 'credit',
        amount: jl.debit > 0 ? jl.debit : jl.credit,
        debit: jl.debit,
        credit: jl.credit,
        account: jl.account,
        accountId: jl.accountId || null,
        accountCodeSnapshot: jl.accountCodeSnapshot || '',
        accountNameSnapshot: jl.accountNameSnapshot || jl.account,
        category: getAccountCategory(jl.account),
        reference: bill.billNumber,
        status: 'posted',
        journalEntryId: journalEntry[0]._id,
        company: req.user.company
      }));
      await Transaction.insertMany(txnsToCreate, { session });
    });

    res.json({ message: `Bill ${bill.billNumber} posted successfully.`, bill });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// POST /api/v1/accounting/bills/:id/payments (Record Payment — Atomic Transaction)
router.post('/bills/:id/payments', async (req, res, next) => {
  const session = await mongoose.startSession();
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
    if (bill.status === 'draft') return res.status(400).json({ message: 'Cannot pay a draft bill. Please post the bill first.' });
    if (bill.status === 'paid') return res.status(400).json({ message: 'Bill is already fully paid.' });
    if (bill.status === 'reversed') return res.status(400).json({ message: 'Cannot record payment on a reversed bill.' });

    const { amount, date, paymentMethod, paymentAccount, reference, notes } = req.body;
    const payAmount = Math.round(Number(amount) * 100) / 100;

    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than 0.' });
    }
    if (payAmount > (bill.outstandingAmount + 0.01)) {
      return res.status(400).json({
        message: `Payment amount (€${payAmount}) exceeds outstanding balance (€${bill.outstandingAmount}).`
      });
    }

    const supplier = await Supplier.findOne({ _id: bill.supplierId, company: req.user.company });
    const acctConfig = await resolveAccountingConfig(req.user.company);

    // Resolve bank account from company config (not hardcoded string)
    const resolvedBankAccountName = paymentAccount ||
      (acctConfig.defaultBankAccountCode
        ? `${acctConfig.defaultBankAccountCode} - ${acctConfig.defaultBankAccountName}`
        : acctConfig.defaultBankAccountName || 'Banco Santander (Main Operating EUR)');

    await session.withTransaction(async () => {
      const paymentNumber = `PAY-${bill.billNumber}-${(bill.payments?.length || 0) + 1}`;
      const jeNumber = await generateNextJournalEntryNumber(req.user.company, session);

      const supplierAccountLabel = supplier?.accountingInfo?.accountCode
        ? `${supplier.accountingInfo.accountCode} - ${supplier.accountingInfo.accountName || bill.supplierName}`
        : (acctConfig.defaultAccountsPayableAccountCode
            ? `${acctConfig.defaultAccountsPayableAccountCode} - ${acctConfig.defaultAccountsPayableAccountName}`
            : 'Accounts Payable');

      // Debit Supplier Liability, Credit Bank Asset
      const rawJournalLines = [
        await enrichJournalLine({
          account: supplierAccountLabel,
          description: `Payment ${paymentNumber} for Bill ${bill.billNumber} (${bill.supplierName})`,
          debit: payAmount,
          credit: 0
        }, req.user.company, session),
        {
          account: resolvedBankAccountName,
          accountId: acctConfig.defaultBankAccountId || null,
          accountCodeSnapshot: acctConfig.defaultBankAccountCode || '',
          accountNameSnapshot: acctConfig.defaultBankAccountName || resolvedBankAccountName,
          description: `Disbursement: ${paymentMethod || 'Bank Transfer'} Ref: ${reference || bill.billNumber}`,
          debit: 0,
          credit: payAmount
        }
      ];

      const journalEntry = await JournalEntry.create([{
        entryNumber: jeNumber,
        date: date ? new Date(date) : new Date(),
        reference: paymentNumber,
        description: `Payment for Bill ${bill.billNumber} — ${bill.supplierName}`,
        entryType: 'payment',
        sourceDocument: { docType: 'payment', docId: bill._id, docNumber: paymentNumber },
        lines: rawJournalLines,
        totalDebit: payAmount,
        totalCredit: payAmount,
        status: 'posted',
        postedAt: new Date(),
        postedBy: req.user.name || req.user.email || 'Admin',
        company: req.user.company
      }], { session });

      bill.payments.push({
        paymentNumber,
        date: date ? new Date(date) : new Date(),
        amount: payAmount,
        paymentMethod: paymentMethod || 'Bank Transfer',
        paymentAccount: resolvedBankAccountName,
        reference: reference || '',
        notes: notes || '',
        journalEntryId: journalEntry[0]._id,
        recordedBy: req.user.name || req.user.email || 'Admin'
      });

      bill.amountPaid = Math.round((bill.amountPaid + payAmount) * 100) / 100;
      bill.outstandingAmount = Math.max(0, Math.round((bill.grandTotal - bill.amountPaid) * 100) / 100);
      bill.status = bill.outstandingAmount <= 0.01 ? 'paid' : 'partially_paid';
      if (bill.status === 'paid') bill.outstandingAmount = 0;

      await bill.save({ session });

      const txnsToCreate = rawJournalLines.map((jl, idx) => ({
        txnId: `TXN-${paymentNumber}-${idx + 1}`,
        date: date ? new Date(date) : new Date(),
        description: jl.description,
        type: jl.debit > 0 ? 'debit' : 'credit',
        amount: payAmount,
        debit: jl.debit,
        credit: jl.credit,
        account: jl.account,
        accountId: jl.accountId || null,
        accountCodeSnapshot: jl.accountCodeSnapshot || '',
        accountNameSnapshot: jl.accountNameSnapshot || jl.account,
        category: getAccountCategory(jl.account),
        reference: paymentNumber,
        status: 'posted',
        journalEntryId: journalEntry[0]._id,
        company: req.user.company
      }));
      await Transaction.insertMany(txnsToCreate, { session });
    });

    res.status(201).json({ message: `Payment ${bill.payments[bill.payments.length - 1].paymentNumber} recorded successfully.`, bill });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// POST /api/v1/accounting/bills/:id/reverse (Reverse Supplier Bill — Atomic Transaction)
router.post('/bills/:id/reverse', async (req, res, next) => {
  const session = await mongoose.startSession();
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
    if (bill.status === 'draft') return res.status(400).json({ message: 'Cannot reverse a draft bill.' });
    if (bill.status === 'reversed') return res.status(400).json({ message: `Bill '${bill.billNumber}' is already reversed.` });
    if (bill.amountPaid > 0) {
      return res.status(400).json({ message: `Cannot reverse bill '${bill.billNumber}' with recorded payments. Please void/reverse payments first.` });
    }

    const { reason } = req.body;
    const origJE = bill.journalEntryId ? await JournalEntry.findById(bill.journalEntryId) : null;

    await session.withTransaction(async () => {
      const reversalNumber = await generateNextJournalEntryNumber(req.user.company, session);

      // Mirror-reverse: swap debits↔credits, preserve accountId references
      const reversalLines = origJE ? origJE.lines.map(l => ({
        account: l.account,
        accountId: l.accountId || null,
        accountCodeSnapshot: l.accountCodeSnapshot || '',
        accountNameSnapshot: l.accountNameSnapshot || l.account,
        description: `Reversal: ${l.description}`,
        debit: l.credit,
        credit: l.debit
      })) : [];

      const reversalEntry = await JournalEntry.create([{
        entryNumber: reversalNumber,
        date: new Date(),
        reference: bill.billNumber,
        description: `Reversal of Bill ${bill.billNumber} — Reason: ${reason || 'Correction'}`,
        entryType: 'reversal',
        sourceDocument: { docType: 'supplier_bill', docId: bill._id, docNumber: bill.billNumber },
        lines: reversalLines,
        totalDebit: bill.grandTotal,
        totalCredit: bill.grandTotal,
        status: 'posted',
        postedAt: new Date(),
        postedBy: req.user.name || req.user.email || 'Admin',
        reversalReason: reason || 'Correction',
        reversalOf: bill.journalEntryId || undefined,
        company: req.user.company
      }], { session });

      // Mark original JE as reversed
      if (origJE) {
        origJE.status = 'reversed';
        origJE.reversedAt = new Date();
        origJE.reversedBy = req.user.name || req.user.email || 'Admin';
        origJE.reversalReason = reason || 'Correction';
        await origJE.save({ session });
      }

      // Mark reversal transactions
      if (reversalLines.length > 0) {
        const txnsToCreate = reversalLines.map((jl, idx) => ({
          txnId: `TXN-REV-${reversalNumber}-${idx + 1}`,
          date: new Date(),
          description: jl.description,
          type: jl.debit > 0 ? 'debit' : 'credit',
          amount: jl.debit > 0 ? jl.debit : jl.credit,
          debit: jl.debit,
          credit: jl.credit,
          account: jl.account,
          accountId: jl.accountId || null,
          accountCodeSnapshot: jl.accountCodeSnapshot || '',
          accountNameSnapshot: jl.accountNameSnapshot || jl.account,
          category: getAccountCategory(jl.account),
          reference: bill.billNumber,
          status: 'posted',
          journalEntryId: reversalEntry[0]._id,
          company: req.user.company
        }));
        await Transaction.insertMany(txnsToCreate, { session });
      }

      bill.status = 'reversed';
      bill.reversedAt = new Date();
      bill.reversedBy = req.user.name || req.user.email || 'Admin';
      bill.reversalReason = reason || 'Correction';
      bill.reversalJournalEntryId = reversalEntry[0]._id;
      await bill.save({ session });
    });

    res.json({ message: `Bill ${bill.billNumber} reversed successfully.`, bill });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. MANUAL JOURNAL ENTRIES CRUD & REVERSALS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/accounting/journal-entries
router.get('/journal-entries', async (req, res, next) => {
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const filter = buildListFilter({ company: req.user.company }, req, {
      searchFields: ['entryNumber', 'reference', 'description'],
      statusField: 'status'
    });

    const result = await paginateQuery(JournalEntry, filter, req, {
      sort: { date: -1, createdAt: -1 }
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/accounting/journal-entries (Create Manual Journal Entry — Atomic Transaction)
router.post('/journal-entries', async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    if (!req.user || !req.user.company) return res.status(403).json({ message: 'Company context required' });

    const { date, reference, description, lines } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ message: 'Journal entry description is required.' });
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ message: 'A journal entry requires at least two lines (double-entry requirement).' });
    }

    // Pre-flight validation (before starting transaction)
    let totalDebit = 0;
    let totalCredit = 0;
    const preflightLines = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const acct = (l.account || '').trim();
      const desc = (l.description || '').trim();
      const debit = Math.round(Number(l.debit || 0) * 100) / 100;
      const credit = Math.round(Number(l.credit || 0) * 100) / 100;

      if (!acct) return res.status(400).json({ message: `Line ${i + 1}: Account is required.` });
      if (debit < 0 || credit < 0) return res.status(400).json({ message: `Line ${i + 1}: Debit and Credit amounts cannot be negative.` });
      if (debit === 0 && credit === 0) return res.status(400).json({ message: `Line ${i + 1}: Line must have either a Debit or Credit amount.` });
      if (debit > 0 && credit > 0) return res.status(400).json({ message: `Line ${i + 1}: Line cannot have both Debit and Credit amounts simultaneously.` });

      const coa = await ChartOfAccount.findOne({
        company: req.user.company,
        $or: [{ accountName: acct }, { accountCode: acct }]
      });
      if (coa && coa.isPostingAccount === false) {
        return res.status(400).json({
          message: `Account '${coa.accountCode} - ${coa.accountName}' is a grouping account (isPostingAccount = false) and cannot receive direct postings.`
        });
      }

      totalDebit += debit;
      totalCredit += credit;
      preflightLines.push({
        account: acct,
        description: desc,
        debit,
        credit,
        accountId: coa ? coa._id : null,
        accountCodeSnapshot: coa ? coa.accountCode : '',
        accountNameSnapshot: coa ? coa.accountName : acct
      });
    }

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({
        message: `Double-entry invariant violated: Total Debits (€${totalDebit.toFixed(2)}) must equal Total Credits (€${totalCredit.toFixed(2)}). Difference: €${Math.abs(totalDebit - totalCredit).toFixed(2)}.`
      });
    }

    let savedJournalEntry;
    const entryDate = date ? new Date(date) : new Date();

    await session.withTransaction(async () => {
      const entryNumber = await generateNextJournalEntryNumber(req.user.company, session);

      const journalEntry = await JournalEntry.create([{
        entryNumber,
        date: entryDate,
        reference: reference ? reference.trim() : '',
        description: description.trim(),
        entryType: 'manual',
        sourceDocument: { docType: 'manual', docNumber: entryNumber },
        lines: preflightLines,
        totalDebit,
        totalCredit,
        status: 'posted',
        postedAt: new Date(),
        postedBy: req.user.name || req.user.email || 'Admin',
        company: req.user.company
      }], { session });

      const txnsToCreate = preflightLines.map((jl, idx) => ({
        txnId: `TXN-JE-${entryNumber}-${idx + 1}`,
        date: entryDate,
        description: jl.description || description.trim(),
        type: jl.debit > 0 ? 'debit' : 'credit',
        amount: jl.debit > 0 ? jl.debit : jl.credit,
        debit: jl.debit,
        credit: jl.credit,
        account: jl.account,
        accountId: jl.accountId || null,
        accountCodeSnapshot: jl.accountCodeSnapshot || '',
        accountNameSnapshot: jl.accountNameSnapshot || jl.account,
        category: getAccountCategory(jl.account),
        reference: entryNumber,
        status: 'posted',
        journalEntryId: journalEntry[0]._id,
        company: req.user.company
      }));
      await Transaction.insertMany(txnsToCreate, { session });

      savedJournalEntry = journalEntry[0];
    });

    res.status(201).json(savedJournalEntry);
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// POST /api/v1/accounting/journal-entries/:id/reverse — Atomic Transaction
router.post('/journal-entries/:id/reverse', async (req, res, next) => {
  const session = await mongoose.startSession();
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
    let savedReversalEntry;

    await session.withTransaction(async () => {
      const reversalNumber = await generateNextJournalEntryNumber(req.user.company, session);

      // Mirror-reverse: swap debits↔credits, preserve accountId references
      const reversalLines = entry.lines.map(l => ({
        account: l.account,
        accountId: l.accountId || null,
        accountCodeSnapshot: l.accountCodeSnapshot || '',
        accountNameSnapshot: l.accountNameSnapshot || l.account,
        description: `Reversal: ${l.description}`,
        debit: l.credit,
        credit: l.debit
      }));

      const reversalEntry = await JournalEntry.create([{
        entryNumber: reversalNumber,
        date: new Date(),
        reference: entry.entryNumber,
        description: `Reversal of ${entry.entryNumber} — Reason: ${reason || 'Correction'}`,
        entryType: 'reversal',
        sourceDocument: { docType: 'manual', docId: entry._id, docNumber: entry.entryNumber },
        lines: reversalLines,
        totalDebit: entry.totalCredit,
        totalCredit: entry.totalDebit,
        status: 'posted',
        postedAt: new Date(),
        postedBy: req.user.name || req.user.email || 'Admin',
        reversalReason: reason || 'Correction',
        reversalOf: entry._id,
        company: req.user.company
      }], { session });

      entry.status = 'reversed';
      entry.reversedAt = new Date();
      entry.reversedBy = req.user.name || req.user.email || 'Admin';
      entry.reversalReason = reason || 'Correction';
      await entry.save({ session });

      const txnsToCreate = reversalLines.map((jl, idx) => ({
        txnId: `TXN-REV-${reversalNumber}-${idx + 1}`,
        date: new Date(),
        description: jl.description,
        type: jl.debit > 0 ? 'debit' : 'credit',
        amount: jl.debit > 0 ? jl.debit : jl.credit,
        debit: jl.debit,
        credit: jl.credit,
        account: jl.account,
        accountId: jl.accountId || null,
        accountCodeSnapshot: jl.accountCodeSnapshot || '',
        accountNameSnapshot: jl.accountNameSnapshot || jl.account,
        category: getAccountCategory(jl.account),
        reference: entry.entryNumber,
        status: 'posted',
        journalEntryId: reversalEntry[0]._id,
        company: req.user.company
      }));
      await Transaction.insertMany(txnsToCreate, { session });

      savedReversalEntry = reversalEntry[0];
    });

    res.json({ message: `Journal entry ${entry.entryNumber} reversed successfully.`, reversalEntry: savedReversalEntry });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// DELETE /api/v1/accounting/journal-entries/:id (Blocked for Audit Protection)
router.delete('/journal-entries/:id', async (req, res) => {
  return res.status(400).json({
    message: 'Posted accounting journal entries cannot be deleted to preserve financial audit integrity. Please use the Reversal action instead.'
  });
});

export default router;
