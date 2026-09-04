import mongoose from 'mongoose';

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

  // ── Bank / Cash Accounts ─────────────────────────────────────────────────────
  defaultBankAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },
  defaultBankAccountCode: { type: String, default: '572.000.001' },
  defaultBankAccountName: { type: String, default: 'Banco Santander (Main Operating EUR)' },

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

export default mongoose.model('CompanyAccountingConfig', companyAccountingConfigSchema);
