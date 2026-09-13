import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import JournalEntry from '../models/JournalEntry.js';
import ChartOfAccount from '../models/ChartOfAccount.js';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import Counter from '../models/Counter.js';
import CompanyAccountingConfig from '../models/CompanyAccountingConfig.js';
import Invoice from '../models/Invoice.js';
import { round2 } from './invoiceCalculationEngine.js';

export const ALLOWED_PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Card', 'Cheque'];
export const APPROVED_TREASURY_CATEGORIES = [
  'Cash & Cash Equivalents',
  'Bank',
  'Cash',
  'Treasury',
  'Clearing'
];

/**
 * Generate atomic sequential payment number: PAY-YYYY-XXXXX
 * Uses SYSTEM CREATION YEAR (not paymentDate)
 */
export async function generateNextPaymentNumber(companyId, session = null) {
  const currentYear = new Date().getFullYear();
  const counterId = `payment_${currentYear}_${companyId}`;
  const counterOpts = session
    ? { session, returnDocument: 'after', upsert: true }
    : { returnDocument: 'after', upsert: true };

  const counter = await Counter.findOneAndUpdate(
    { _id: counterId, company: companyId },
    { $inc: { seq: 1 } },
    counterOpts
  );

  if (!counter || !counter.seq) {
    throw new Error('Failed to generate atomic sequential payment number.');
  }

  return `PAY-${currentYear}-${String(counter.seq).padStart(5, '0')}`;
}

/**
 * Generate atomic sequential journal entry number: JE-YYYY-XXXXX
 * Uses SYSTEM CREATION YEAR
 */
export async function generateNextJournalEntryNumber(companyId, session = null) {
  const currentYear = new Date().getFullYear();
  const counterId = `journal_entry_${currentYear}_${companyId}`;
  const counterOpts = session
    ? { session, returnDocument: 'after', upsert: true }
    : { returnDocument: 'after', upsert: true };

  const counter = await Counter.findOneAndUpdate(
    { _id: counterId, company: companyId },
    { $inc: { seq: 1 } },
    counterOpts
  );

  if (!counter || !counter.seq) {
    throw new Error('Failed to generate atomic sequential journal entry number.');
  }

  return `JE-${currentYear}-${String(counter.seq).padStart(5, '0')}`;
}

/**
 * Validates whether a given ChartOfAccount is an approved treasury/bank/cash account
 * for customer payments according to Section 15.2 of the Phase 8C.3 architecture.
 */
export function validatePaymentAccount(account, companyId, config = null) {
  if (!account) {
    const err = new Error('Payment account not found or does not belong to your company.');
    err.status = 400;
    throw err;
  }

  // 1. Must match tenant company
  if (account.company.toString() !== companyId.toString()) {
    const err = new Error('Payment account does not belong to your company.');
    err.status = 400;
    throw err;
  }

  // 2. Must be active and a posting account
  if (!account.active) {
    const err = new Error(`Payment account '${account.accountCode} - ${account.accountName}' is inactive.`);
    err.status = 400;
    throw err;
  }

  if (!account.isPostingAccount) {
    const err = new Error(`Payment account '${account.accountCode} - ${account.accountName}' is a non-posting header/grouping account.`);
    err.status = 400;
    throw err;
  }

  // 3. Must have accountType: 'Asset'
  if (account.accountType !== 'Asset') {
    const err = new Error(`Payment account must have accountType 'Asset' (got '${account.accountType}').`);
    err.status = 400;
    throw err;
  }

  const code = account.accountCode || '';
  const category = account.category || '';
  const name = account.accountName || '';

  // 4. Explicit rejections:
  // - Inventory Asset accounts (Group 30 / starting with 3)
  if (code.startsWith('3') || category.toLowerCase().includes('inventory')) {
    const err = new Error(`Payment account cannot be an Inventory Asset account ('${code}').`);
    err.status = 400;
    throw err;
  }

  // - Fixed Asset accounts (Group 20/21 / starting with 2)
  if (code.startsWith('2') || category.toLowerCase().includes('fixed asset')) {
    const err = new Error(`Payment account cannot be a Fixed Asset account ('${code}').`);
    err.status = 400;
    throw err;
  }

  // - Accounts Receivable accounts (Group 43 / starting with 43 / default AR)
  if (
    code.startsWith('430') ||
    code === '430' ||
    (config?.defaultAccountsReceivableAccountId && account._id.equals(config.defaultAccountsReceivableAccountId)) ||
    (config?.defaultUnbilledReceivableAccountId && account._id.equals(config.defaultUnbilledReceivableAccountId))
  ) {
    const err = new Error(`Payment account cannot be an Accounts Receivable account ('${code}').`);
    err.status = 400;
    throw err;
  }

  // - Customer Deposit account 438
  if (
    code === '438' ||
    code.startsWith('438') ||
    (config?.defaultCustomerDepositAccountId && account._id.equals(config.defaultCustomerDepositAccountId))
  ) {
    const err = new Error(`Payment account cannot be Customer Deposit account ('${code}').`);
    err.status = 400;
    throw err;
  }

  // - Tax accounts (starting with 47)
  if (code.startsWith('47')) {
    const err = new Error(`Payment account cannot be a Tax account ('${code}').`);
    err.status = 400;
    throw err;
  }

  // 5. Positive Treasury Qualification
  const isTreasuryGroup = code.startsWith('57'); // Spanish PGC Group 57 (Tesorería)
  const isConfiguredDefault = Boolean(
    (config?.defaultBankAccountId && account._id.equals(config.defaultBankAccountId)) ||
    (config?.defaultCashAccountId && account._id.equals(config.defaultCashAccountId))
  );
  const isApprovedCategory = APPROVED_TREASURY_CATEGORIES.some(cat =>
    category.toLowerCase().includes(cat.toLowerCase())
  );
  const isLiquidName = ['Bank', 'Cash', 'Petty Cash', 'Treasury', 'Stripe', 'PayPal', 'Clearing'].some(term =>
    name.toLowerCase().includes(term.toLowerCase())
  );

  if (!isTreasuryGroup && !isConfiguredDefault && !isApprovedCategory && !isLiquidName) {
    const err = new Error(`Account '${code} - ${name}' is not an approved treasury, bank, or cash account.`);
    err.status = 400;
    throw err;
  }

  return true;
}

/**
 * Executes authoritative customer payment/receipt creation inside a MongoDB transaction.
 * Creates Payment (status: unallocated) + JournalEntry (Dr PaymentAccount / Cr CustomerDeposit 438).
 */
export async function recordPaymentReceipt({ companyId, body, user, session }) {
  // 1. Tenant & Company Validation
  if (body.company && body.company.toString() !== companyId.toString()) {
    const err = new Error('Company mismatch: cannot record payment for another company.');
    err.status = 400;
    throw err;
  }

  const companyDoc = await Company.findById(companyId).session(session);
  if (!companyDoc) {
    const err = new Error('Company context not found.');
    err.status = 404;
    throw err;
  }

  const authoritativeCurrency = companyDoc.currency || 'EUR';
  if (authoritativeCurrency !== 'EUR') {
    const err = new Error(`Company currency '${authoritativeCurrency}' is not supported. Only EUR is supported.`);
    err.status = 400;
    throw err;
  }

  if (body.currency && body.currency !== 'EUR') {
    const err = new Error(`Currency '${body.currency}' is not supported. Only EUR is supported.`);
    err.status = 400;
    throw err;
  }

  // 2. Customer Validation
  if (!body.customerId) {
    const err = new Error('customerId is required.');
    err.status = 400;
    throw err;
  }

  if (!mongoose.isValidObjectId(body.customerId)) {
    const err = new Error('customerId must be a valid ObjectId.');
    err.status = 400;
    throw err;
  }

  const customer = await Customer.findOne({ _id: body.customerId, company: companyId }).session(session);
  if (!customer) {
    const err = new Error('Selected Customer was not found in your company records.');
    err.status = 400;
    throw err;
  }

  // 3. Amount Validation & Precision Rounding
  const rawAmount = body.amount;
  if (typeof rawAmount !== 'number' || isNaN(rawAmount) || rawAmount <= 0) {
    const err = new Error('Payment amount must be a positive number greater than 0.');
    err.status = 400;
    throw err;
  }

  const amount = round2(rawAmount);
  if (amount <= 0) {
    const err = new Error('Payment amount must be at least 0.01 after rounding.');
    err.status = 400;
    throw err;
  }

  // 4. Payment Method Validation
  const method = body.method || 'Bank Transfer';
  if (!ALLOWED_PAYMENT_METHODS.includes(method)) {
    const err = new Error(`Invalid payment method '${body.method}'. Allowed methods: ${ALLOWED_PAYMENT_METHODS.join(', ')}.`);
    err.status = 400;
    throw err;
  }

  // 5. Payment Date Validation
  const parsedPaymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();
  if (isNaN(parsedPaymentDate.getTime())) {
    const err = new Error('Invalid paymentDate format. Expected a valid date.');
    err.status = 400;
    throw err;
  }

  // 6. Company Accounting Configuration & Customer Deposit Account Resolution
  const config = await CompanyAccountingConfig.findOne({ company: companyId }).session(session);
  if (!config || !config.defaultCustomerDepositAccountId) {
    const err = new Error('HARD ACCOUNTING EXCEPTION: CompanyAccountingConfig is missing defaultCustomerDepositAccountId.');
    err.status = 400;
    throw err;
  }

  const customerDepositAccount = await ChartOfAccount.findOne({
    _id: config.defaultCustomerDepositAccountId,
    company: companyId
  }).session(session);

  if (!customerDepositAccount) {
    const err = new Error('HARD ACCOUNTING EXCEPTION: Configured Customer Deposit account not found or belongs to another company.');
    err.status = 400;
    throw err;
  }

  if (!customerDepositAccount.active) {
    const err = new Error(`Configured Customer Deposit account '${customerDepositAccount.accountCode}' is inactive.`);
    err.status = 400;
    throw err;
  }

  if (!customerDepositAccount.isPostingAccount) {
    const err = new Error(`Configured Customer Deposit account '${customerDepositAccount.accountCode}' is a non-posting grouping account.`);
    err.status = 400;
    throw err;
  }

  // 7. Payment Account Resolution & Strict Qualification
  let targetAccountId = body.paymentAccountId;
  if (!targetAccountId) {
    targetAccountId = method === 'Cash' ? config.defaultCashAccountId : config.defaultBankAccountId;
  }

  if (!targetAccountId) {
    const err = new Error('paymentAccountId is required or must be configured in CompanyAccountingConfig.');
    err.status = 400;
    throw err;
  }

  if (!mongoose.isValidObjectId(targetAccountId)) {
    const err = new Error('paymentAccountId must be a valid ObjectId.');
    err.status = 400;
    throw err;
  }

  const paymentAccount = await ChartOfAccount.findOne({
    _id: targetAccountId,
    company: companyId
  }).session(session);

  // Throws 400 on invalid or non-treasury account
  validatePaymentAccount(paymentAccount, companyId, config);

  // 8. Atomic Sequential Numbering
  const paymentNumber = await generateNextPaymentNumber(companyId, session);
  const jeNumber = await generateNextJournalEntryNumber(companyId, session);

  const paymentId = new mongoose.Types.ObjectId();
  const jeId = new mongoose.Types.ObjectId();
  const recordedByName = user?.name || user?.username || 'System';

  // 9. Create Receipt JournalEntry (Dr PaymentAccount / Cr Customer Deposit 438)
  const journalEntry = new JournalEntry({
    _id: jeId,
    entryNumber: jeNumber,
    company: companyId,
    date: parsedPaymentDate,
    entryType: 'payment',
    sourceDocument: {
      docType: 'payment',
      docId: paymentId,
      docNumber: paymentNumber
    },
    reference: paymentNumber,
    description: `Customer payment receipt: ${paymentNumber} from ${customer.name}`,
    lines: [
      {
        accountId: paymentAccount._id,
        accountCodeSnapshot: paymentAccount.accountCode,
        accountNameSnapshot: paymentAccount.accountName,
        account: paymentAccount.accountName,
        description: `Payment receipt ${paymentNumber}`,
        debit: amount,
        credit: 0
      },
      {
        accountId: customerDepositAccount._id,
        accountCodeSnapshot: customerDepositAccount.accountCode,
        accountNameSnapshot: customerDepositAccount.accountName,
        account: customerDepositAccount.accountName,
        description: `Customer deposit for payment ${paymentNumber}`,
        debit: 0,
        credit: amount
      }
    ],
    totalDebit: amount,
    totalCredit: amount,
    status: 'posted',
    postedAt: new Date(),
    postedBy: recordedByName
  });

  // Saving triggers JournalEntry.pre('save') which enforces FiscalPeriod validation
  await journalEntry.save({ session });

  // 10. Create Payment Document (status: unallocated, unappliedAmount = amount)
  const payment = new Payment({
    _id: paymentId,
    paymentNumber,
    company: companyId,
    customerId: customer._id,
    customerNameSnapshot: customer.name,
    amount,
    currency: 'EUR',
    paymentDate: parsedPaymentDate,
    method,
    paymentAccountId: paymentAccount._id,
    paymentAccountSnapshot: {
      code: paymentAccount.accountCode,
      name: paymentAccount.accountName
    },
    reference: body.reference ? String(body.reference).trim() : '',
    notes: body.notes ? String(body.notes).trim() : '',
    status: 'unallocated',
    unappliedAmount: amount,
    journalEntryId: jeId,
    recordedBy: recordedByName,
    allocations: []
  });

  await payment.save({ session });

  return { payment, journalEntry };
}

/**
 * Executes authoritative customer payment allocation to an invoice inside a MongoDB transaction.
 * Dr Customer Deposits (Account 438) / Cr Accounts Receivable (Account 430).
 * No Cash/Bank movement occurs during allocation.
 */
export async function recordPaymentAllocation({ companyId, paymentId, body, user, session }) {
  // 1. Client-supplied forbidden fields validation
  const FORBIDDEN_CLIENT_FIELDS = [
    'allocationId',
    'journalEntryId',
    'previousInvoiceStatus',
    'invoiceNumber',
    'customerId',
    'customerName',
    'status',
    'amountPaid',
    'outstandingAmount'
  ];
  for (const f of FORBIDDEN_CLIENT_FIELDS) {
    if (body[f] !== undefined) {
      const err = new Error(`Client-supplied '${f}' is forbidden. Allocation metadata is strictly derived server-side.`);
      err.status = 400;
      throw err;
    }
  }

  // 2. Validate invoiceId
  if (!body.invoiceId) {
    const err = new Error('invoiceId is required.');
    err.status = 400;
    throw err;
  }
  if (!mongoose.isValidObjectId(body.invoiceId)) {
    const err = new Error('invoiceId must be a valid ObjectId.');
    err.status = 400;
    throw err;
  }

  // 3. Validate allocatedAmount
  const rawAllocated = body.allocatedAmount;
  if (typeof rawAllocated !== 'number' || isNaN(rawAllocated) || rawAllocated <= 0) {
    const err = new Error('allocatedAmount must be a positive number greater than 0.');
    err.status = 400;
    throw err;
  }
  const allocatedAmount = round2(rawAllocated);
  if (allocatedAmount <= 0) {
    const err = new Error('allocatedAmount must be at least 0.01 after rounding.');
    err.status = 400;
    throw err;
  }

  // 4. Backdating / allocatedAt Authorization & Validation
  if (body.allocatedAt && user?.role !== 'admin') {
    const err = new Error('Only users with role admin are authorized to specify a custom allocation date.');
    err.status = 403;
    throw err;
  }
  const parsedAllocatedAt = body.allocatedAt ? new Date(body.allocatedAt) : new Date();
  if (isNaN(parsedAllocatedAt.getTime())) {
    const err = new Error('Invalid allocatedAt format. Expected a valid date.');
    err.status = 400;
    throw err;
  }

  // 5. Fetch and Validate Payment in Transaction Session
  if (!mongoose.isValidObjectId(paymentId)) {
    const err = new Error('Payment not found.');
    err.status = 404;
    throw err;
  }

  const payment = await Payment.findOne({ _id: paymentId, company: companyId }).session(session);
  if (!payment) {
    const err = new Error('Payment not found.');
    err.status = 404;
    throw err;
  }

  if (payment.status === 'reversed') {
    const err = new Error('Cannot allocate from a reversed payment.');
    err.status = 400;
    throw err;
  }

  if (payment.currency !== 'EUR') {
    const err = new Error(`Payment currency '${payment.currency}' is not supported. Only EUR is supported.`);
    err.status = 400;
    throw err;
  }

  if (!payment.journalEntryId) {
    const err = new Error('Payment lacks authoritative receipt JournalEntry linkage.');
    err.status = 400;
    throw err;
  }

  if (payment.unappliedAmount <= 0 || payment.status === 'fully_allocated') {
    const err = new Error(`Payment has no unapplied balance available for allocation (unapplied: €${payment.unappliedAmount}).`);
    err.status = 400;
    throw err;
  }

  if (allocatedAmount > payment.unappliedAmount) {
    const err = new Error(`Allocation amount (€${allocatedAmount}) exceeds Payment unapplied amount (€${payment.unappliedAmount}).`);
    err.status = 400;
    throw err;
  }

  // 6. Fetch and Validate Invoice in Transaction Session
  const invoice = await Invoice.findOne({ _id: body.invoiceId, company: companyId }).session(session);
  if (!invoice) {
    const err = new Error('Invoice not found.');
    err.status = 404;
    throw err;
  }

  if (invoice.company.toString() !== companyId.toString()) {
    const err = new Error('Invoice belongs to another company.');
    err.status = 404;
    throw err;
  }

  if (invoice.currency !== 'EUR') {
    const err = new Error(`Invoice currency '${invoice.currency}' is not supported. Only EUR is supported.`);
    err.status = 400;
    throw err;
  }

  if (invoice.status === 'cancelled') {
    const err = new Error('Cannot allocate payment to a cancelled invoice.');
    err.status = 400;
    throw err;
  }

  if (invoice.status === 'paid' || (invoice.outstandingAmount !== null && invoice.outstandingAmount <= 0)) {
    const err = new Error(`Cannot allocate payment to an already paid invoice (status: '${invoice.status}', outstanding: €${invoice.outstandingAmount}).`);
    err.status = 400;
    throw err;
  }

  if (invoice.historicalReconciliationState === 'MANUAL_REVIEW_REQUIRED') {
    const err = new Error('Invoice is flagged MANUAL_REVIEW_REQUIRED and is quarantined from payment allocation.');
    err.status = 400;
    throw err;
  }

  if (invoice.historicalReconciliationState === 'LEGACY_UNVERIFIED') {
    const err = new Error('Invoice is flagged LEGACY_UNVERIFIED and is quarantined from payment allocation.');
    err.status = 400;
    throw err;
  }

  if (typeof invoice.outstandingAmount !== 'number' || invoice.outstandingAmount <= 0) {
    const err = new Error(`Invoice has no allocatable outstanding balance (outstanding: ${invoice.outstandingAmount}).`);
    err.status = 400;
    throw err;
  }

  if (allocatedAmount > invoice.outstandingAmount) {
    const err = new Error(`Allocation amount (€${allocatedAmount}) exceeds Invoice outstanding amount (€${invoice.outstandingAmount}).`);
    err.status = 400;
    throw err;
  }

  // 7. Customer Match Validation
  if (payment.customerId.toString() !== invoice.customerId.toString()) {
    const err = new Error(`Customer mismatch: Payment customer '${payment.customerId}' does not match Invoice customer '${invoice.customerId}'.`);
    err.status = 400;
    throw err;
  }

  // 8. Capture Previous Invoice Status Snapshot
  const allowedPrevious = ['issued', 'sent', 'partially_paid'];
  if (!allowedPrevious.includes(invoice.status)) {
    const err = new Error(`Cannot allocate to an invoice with status '${invoice.status}'. Status must be one of: ${allowedPrevious.join(', ')}.`);
    err.status = 400;
    throw err;
  }
  const previousInvoiceStatus = invoice.status;

  // 9. Resolve CoA Accounts from CompanyAccountingConfig
  const config = await CompanyAccountingConfig.findOne({ company: companyId }).session(session);
  if (!config || !config.defaultCustomerDepositAccountId) {
    const err = new Error('HARD ACCOUNTING EXCEPTION: CompanyAccountingConfig is missing defaultCustomerDepositAccountId.');
    err.status = 400;
    throw err;
  }
  if (!config.defaultAccountsReceivableAccountId) {
    const err = new Error('HARD ACCOUNTING EXCEPTION: CompanyAccountingConfig is missing defaultAccountsReceivableAccountId.');
    err.status = 400;
    throw err;
  }

  const customerDepositAccount = await ChartOfAccount.findOne({
    _id: config.defaultCustomerDepositAccountId,
    company: companyId
  }).session(session);

  if (!customerDepositAccount || !customerDepositAccount.active || !customerDepositAccount.isPostingAccount) {
    const err = new Error('Configured Customer Deposit account is invalid, inactive, or non-posting.');
    err.status = 400;
    throw err;
  }

  const arAccount = await ChartOfAccount.findOne({
    _id: config.defaultAccountsReceivableAccountId,
    company: companyId
  }).session(session);

  if (!arAccount || !arAccount.active || !arAccount.isPostingAccount) {
    const err = new Error('Configured Accounts Receivable account is invalid, inactive, or non-posting.');
    err.status = 400;
    throw err;
  }

  // 10. Generate Stable Identity and Sequential JE Number
  const allocationId = new mongoose.Types.ObjectId();
  const jeId = new mongoose.Types.ObjectId();
  const jeNumber = await generateNextJournalEntryNumber(companyId, session);
  const recordedByName = user?.name || user?.username || 'System';

  // 11. Create Allocation JournalEntry (Dr 438 / Cr 430)
  // Allocation JE clearly identifies the allocation itself, including allocationId, invoice, and payment
  const journalEntry = new JournalEntry({
    _id: jeId,
    entryNumber: jeNumber,
    company: companyId,
    date: parsedAllocatedAt,
    entryType: 'payment',
    sourceDocument: {
      docType: 'payment',
      docId: payment._id,
      docNumber: payment.paymentNumber
    },
    reference: `${payment.paymentNumber}:${invoice.invoiceNumber}:${allocationId}`,
    description: `Payment allocation ${allocationId}: ${payment.paymentNumber} to Invoice ${invoice.invoiceNumber}`,
    notes: `Allocation ${allocationId} applied €${allocatedAmount} from Payment ${payment.paymentNumber} to Invoice ${invoice.invoiceNumber}`,
    lines: [
      {
        accountId: customerDepositAccount._id,
        accountCodeSnapshot: customerDepositAccount.accountCode,
        accountNameSnapshot: customerDepositAccount.accountName,
        account: customerDepositAccount.accountName,
        description: `Customer deposit applied — ${payment.paymentNumber} to ${invoice.invoiceNumber} (Alloc ${allocationId})`,
        debit: allocatedAmount,
        credit: 0
      },
      {
        accountId: arAccount._id,
        accountCodeSnapshot: arAccount.accountCode,
        accountNameSnapshot: arAccount.accountName,
        account: arAccount.accountName,
        description: `AR reduction — ${invoice.invoiceNumber} from ${payment.paymentNumber} (Alloc ${allocationId})`,
        debit: 0,
        credit: allocatedAmount
      }
    ],
    totalDebit: allocatedAmount,
    totalCredit: allocatedAmount,
    status: 'posted',
    postedAt: new Date(),
    postedBy: recordedByName
  });

  // Saving triggers JournalEntry.pre('save') which enforces FiscalPeriod validation
  await journalEntry.save({ session });

  // 12. Update Payment State
  payment.allocations.push({
    allocationId,
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    previousInvoiceStatus,
    allocatedAmount,
    allocatedAt: parsedAllocatedAt,
    allocatedBy: recordedByName,
    journalEntryId: jeId,
    isReversed: false,
    reversedAt: null,
    reversedBy: null,
    reversalJournalEntryId: null,
    reversalReason: ''
  });

  payment.unappliedAmount = round2(payment.unappliedAmount - allocatedAmount);
  if (payment.unappliedAmount === 0) {
    payment.status = 'fully_allocated';
  } else if (payment.unappliedAmount < payment.amount) {
    payment.status = 'partially_allocated';
  } else {
    payment.status = 'unallocated';
  }

  await payment.save({ session });

  // 13. Update Invoice State
  invoice.payments.push({
    paymentId: payment._id,
    paymentNumber: payment.paymentNumber,
    allocationId,
    allocatedAmount,
    allocatedAt: parsedAllocatedAt,
    allocatedBy: recordedByName
  });

  invoice.amountPaid = round2(invoice.amountPaid + allocatedAmount);
  invoice.outstandingAmount = round2(invoice.outstandingAmount - allocatedAmount);

  // Exact 0.00 check per mandatory correction #1
  if (invoice.outstandingAmount === 0.00) {
    invoice.status = 'paid';
  } else {
    invoice.status = 'partially_paid';
  }

  await invoice.save({ session });

  return { payment, invoice, journalEntry, allocationId };
}
