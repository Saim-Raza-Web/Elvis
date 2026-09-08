import mongoose from 'mongoose';
import ChartOfAccount from './ChartOfAccount.js';

/**
 * CompanyAccountingConfig — Per-company accounting mapping configuration.
 *
 * Links financial posting categories (VAT, bank, AP, AR, etc.) to specific
 * ChartOfAccount ObjectId references. This replaces hardcoded string labels
 * like 'Input VAT (Tax Deductible)' in the accounting engine.
 *
 * One document per company. Upserted during onboarding or explicit configuration.
 */
const companyAccountingConfigSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true,
    index: true
  },

  // ── VAT Accounts ────────────────────────────────────────────────────────────
  defaultInputVATAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultInputVATAccountCode: { type: String, default: '472' },
  defaultInputVATAccountName: { type: String, default: 'Input VAT (Tax Deductible)' },

  defaultOutputVATAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultOutputVATAccountCode: { type: String, default: '477' },
  defaultOutputVATAccountName: { type: String, default: 'Output VAT (Taxes Payable)' },

  defaultTaxPayableAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultTaxPayableAccountCode: { type: String, default: '477.0' },
  defaultTaxPayableAccountName: { type: String, default: 'Tax Payable' },

  // ── Bank / Cash Accounts ─────────────────────────────────────────────────────
  defaultBankAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultBankAccountCode: { type: String, default: '572.000.001' },
  defaultBankAccountName: { type: String, default: 'Banco Santander (Main Operating EUR)' },

  defaultCashAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultCashAccountCode: { type: String, default: '570' },
  defaultCashAccountName: { type: String, default: 'Cash / Petty Cash' },

  // ── Accounts Payable (Supplier Liability) ────────────────────────────────────
  defaultAccountsPayableAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultAccountsPayableAccountCode: { type: String, default: '400' },
  defaultAccountsPayableAccountName: { type: String, default: 'Suppliers' },

  // ── Accounts Receivable ──────────────────────────────────────────────────────
  defaultAccountsReceivableAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultAccountsReceivableAccountCode: { type: String, default: '430' },
  defaultAccountsReceivableAccountName: { type: String, default: 'Customers' },

  defaultUnbilledReceivableAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultUnbilledReceivableAccountCode: { type: String, default: '430.9' },
  defaultUnbilledReceivableAccountName: { type: String, default: 'Unbilled Receivables (Shipped, Not Invoiced)' },

  defaultCustomerDepositAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultCustomerDepositAccountCode: { type: String, default: '438' },
  defaultCustomerDepositAccountName: { type: String, default: 'Customer Deposits (Unapplied Cash)' },

  // ── Revenue ──────────────────────────────────────────────────────────────────
  defaultSalesRevenueAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultSalesRevenueAccountCode: { type: String, default: '700.000.001' },
  defaultSalesRevenueAccountName: { type: String, default: 'Product Sales' },

  // ── Inventory Asset ────────────────────────────────────────────────────────────
  defaultInventoryAssetAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultInventoryAssetAccountCode: { type: String, default: '300' },
  defaultInventoryAssetAccountName: { type: String, default: 'Merchandise Inventory' },

  // ── GRNI (Liability) ──────────────────────────────────────────────────────────
  defaultGRNIAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultGRNIAccountCode: { type: String, default: '400.9' },
  defaultGRNIAccountName: { type: String, default: 'Goods Received Not Invoiced (GRNI)' },

  // ── Purchase Expense ─────────────────────────────────────────────────────────
  defaultPurchaseExpenseAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultPurchaseExpenseAccountCode: { type: String, default: '600' },
  defaultPurchaseExpenseAccountName: { type: String, default: 'Purchases of Merchandise' },

  // ── COGS (Cost of Goods Sold) ────────────────────────────────────────────────
  defaultCOGSAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultCOGSAccountCode: { type: String, default: '610' },
  defaultCOGSAccountName: { type: String, default: 'Cost of Goods Sold (Variation)' },

  // ── Configuration Metadata ───────────────────────────────────────────────────
  configuredBy: { type: String, default: 'System' },
  isBootstrapped: { type: Boolean, default: false } // true once accounts are resolved from CoA
}, {
  timestamps: true
});

/**
 * Strict Server-Side Validation logic protecting the configuration.
 */
async function validateAccounts(doc, companyId) {
  const fieldsToValidate = [
    { field: 'defaultAccountsReceivableAccountId', type: 'Asset' },
    { field: 'defaultUnbilledReceivableAccountId', type: 'Asset' },
    { field: 'defaultCashAccountId', type: 'Asset' },
    { field: 'defaultBankAccountId', type: 'Asset' },
    { field: 'defaultInventoryAssetAccountId', type: 'Asset' },
    { field: 'defaultSalesRevenueAccountId', type: 'Revenue' },
    { field: 'defaultTaxPayableAccountId', type: 'Liability' },
    { field: 'defaultCustomerDepositAccountId', type: 'Liability' },
    { field: 'defaultOutputVATAccountId', type: 'Liability' },
    { field: 'defaultInputVATAccountId', type: 'Asset' }, // Spanish accounting often uses 472 as asset/deductible
    { field: 'defaultAccountsPayableAccountId', type: 'Liability' },
    { field: 'defaultGRNIAccountId', type: 'Liability' },
    { field: 'defaultPurchaseExpenseAccountId', type: 'Expense' },
    { field: 'defaultCOGSAccountId', type: 'Expense' }
  ];

  const errors = [];
  
  for (const { field, type } of fieldsToValidate) {
    const accountId = doc[field];
    if (accountId) {
      const account = await mongoose.model('ChartOfAccount').findOne({ _id: accountId, company: companyId });
      
      if (!account) {
        errors.push(`${field}: Account not found or does not belong to this company.`);
      } else if (!account.active) {
        errors.push(`${field}: Account '${account.accountName}' is inactive.`);
      } else if (account.accountType !== type) {
        errors.push(`${field}: Account '${account.accountName}' has type '${account.accountType}', but must be '${type}'.`);
      } else if (account.isPostingAccount === false) {
        errors.push(`${field}: Account '${account.accountName}' is not a posting account.`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error('Accounting Configuration Validation Failed:\n' + errors.join('\n'));
  }
}

// Hook for .save()
companyAccountingConfigSchema.pre('save', async function() {
  await validateAccounts(this, this.company);
});

// Hook for updates
companyAccountingConfigSchema.pre('findOneAndUpdate', async function() {
  const update = this.getUpdate();
  
  // Create a virtual doc with the update applied to validate it
  const docToValidate = update.$set ? update.$set : update;
  
  const companyId = this.getQuery().company;
  if (!companyId) {
    // If no company context is given in the query, we must reject or fetch the existing doc to ensure safety
    const doc = await this.model.findOne(this.getQuery());
    if (doc) {
      await validateAccounts(docToValidate, doc.company);
    }
  } else {
    await validateAccounts(docToValidate, companyId);
  }
});

export default mongoose.model('CompanyAccountingConfig', companyAccountingConfigSchema);
