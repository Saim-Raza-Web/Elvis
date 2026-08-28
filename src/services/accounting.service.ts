import api from './api';
import type { PaginatedResult } from './listApi';
import type { PaginationMeta } from '../utils/listResponse';

export interface BillLine {
  expenseAccount: string;
  description: string;
  quantity: number;
  uom?: string;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  lineSubtotal?: number;
  lineTax?: number;
  lineTotal?: number;
}

export interface BillPayment {
  _id?: string;
  paymentNumber: string;
  date: string;
  amount: number;
  paymentMethod: string;
  paymentAccount: string;
  reference?: string;
  notes?: string;
  recordedBy?: string;
}

export interface SupplierBill {
  _id: string;
  billNumber: string;
  supplierId: string | { _id: string; name: string; taxId?: string; email?: string };
  supplierName: string;
  supplierTaxId?: string;
  supplierEmail?: string;
  supplierInvoiceNumber: string;
  billDate: string;
  dueDate?: string;
  paymentTerms?: string;
  currency?: string;
  lines: BillLine[];
  subtotal: number;
  discountTotal: number;
  totalTax: number;
  grandTotal: number;
  taxBreakdown: { taxRate: number; taxableAmount: number; taxAmount: number }[];
  amountPaid: number;
  outstandingAmount: number;
  status: 'draft' | 'posted' | 'partially_paid' | 'paid' | 'reversed';
  postedAt?: string;
  postedBy?: string;
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  journalEntryId?: any;
  payments: BillPayment[];
  notes?: string;
}

export interface JournalLine {
  account: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  _id: string;
  entryNumber: string;
  date: string;
  reference?: string;
  description: string;
  entryType: 'manual' | 'supplier_bill' | 'customer_invoice' | 'payment' | 'reversal';
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  status: 'draft' | 'posted' | 'reversed';
  postedAt?: string;
  postedBy?: string;
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  notes?: string;
}

export interface AccountItem {
  _id?: string;
  accountCode?: string;
  name: string;
  category: string;
  accountType?: string;
  isPostingAccount?: boolean;
  hierarchyLevel?: number;
  allowSubAccounts?: boolean;
  balance: number;
  debitTotal: number;
  creditTotal: number;
  change: number;
}

export interface ChartOfAccountRecord {
  _id: string;
  accountCode: string;
  accountName: string;
  accountType: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
  category: string;
  parentAccountId?: { _id: string; accountCode: string; accountName: string } | null;
  parentAccountCode?: string;
  hierarchyLevel: number;
  allowSubAccounts: boolean;
  isPostingAccount: boolean;
  supplierId?: { _id: string; name: string; email?: string; taxId?: string } | null;
  active: boolean;
  description?: string;
  balance?: number;
  debitTotal?: number;
  creditTotal?: number;
}

export interface ImportPreviewRow {
  rowNumber: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  parentAccountCode: string;
  allowSubAccounts: boolean;
  isPostingAccount: boolean;
  status: 'VALID' | 'INVALID';
  action: 'NEW' | 'UPDATE';
  issues: string[];
}

export interface ImportPreviewResponse {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  newCount: number;
  updateCount: number;
  previewRows: ImportPreviewRow[];
  errors: { rowNumber: number; accountCode: string; reason: string }[];
}

export interface ImportExecuteResponse {
  importId: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  log?: any;
}

export interface ChartOfAccountImportLog {
  _id: string;
  importId: string;
  fileName: string;
  importMode: 'create_new_only' | 'update_existing' | 'dry_run';
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errorDetails: { rowNumber: number; accountCode: string; reason: string }[];
  importedBy: string;
  createdAt: string;
}

export interface AccountingListResult {
  transactions: PaginatedResult<Record<string, unknown>>;
  accounts: AccountItem[];
  stats?: {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    profitMargin: number;
    accountsPayable: number;
    accountsReceivable: number;
  };
}

export const accountingService = {
  // ── Overview ─────────────────────────────────────────────────────────────
  async getOverview(params?: Record<string, any>): Promise<AccountingListResult> {
    const res = await api.get('/accounting', { params });
    return res.data;
  },

  // ── Chart of Accounts ───────────────────────────────────────────────────
  async getAccounts(params?: { search?: string; postingOnly?: boolean }): Promise<ChartOfAccountRecord[]> {
    const res = await api.get('/accounting/accounts', { params });
    return res.data;
  },

  async getNextAccountCode(params: { parentAccountId?: string; parentAccountCode?: string }): Promise<{
    parentCode: string;
    parentName: string;
    suggestedCode: string;
    hierarchyLevel: number;
    accountType: string;
    category: string;
  }> {
    const res = await api.post('/accounting/accounts/next-code', params);
    return res.data;
  },

  async createAccount(data: {
    accountCode: string;
    accountName: string;
    accountType: string;
    category?: string;
    parentAccountId?: string | null;
    parentAccountCode?: string;
    allowSubAccounts?: boolean;
    isPostingAccount?: boolean;
    description?: string;
    supplierId?: string | null;
  }): Promise<ChartOfAccountRecord> {
    const res = await api.post('/accounting/accounts', data);
    return res.data;
  },

  async updateAccount(id: string, data: Partial<ChartOfAccountRecord>): Promise<ChartOfAccountRecord> {
    const res = await api.put(`/accounting/accounts/${id}`, data);
    return res.data;
  },

  async deleteAccount(id: string): Promise<{ message: string }> {
    const res = await api.delete(`/accounting/accounts/${id}`);
    return res.data;
  },

  async previewAccountImport(data: {
    rows: any[];
    columnMapping?: Record<string, string>;
  }): Promise<ImportPreviewResponse> {
    const res = await api.post('/accounting/accounts/import/preview', data);
    return res.data;
  },

  async executeAccountImport(data: {
    rows: any[];
    columnMapping?: Record<string, string>;
    importMode?: 'create_new_only' | 'update_existing';
    fileName?: string;
  }): Promise<ImportExecuteResponse> {
    const res = await api.post('/accounting/accounts/import/execute', data);
    return res.data;
  },

  async getImportHistory(): Promise<ChartOfAccountImportLog[]> {
    const res = await api.get('/accounting/accounts/import/history');
    return res.data;
  },

  // ── Supplier Bills ───────────────────────────────────────────────────────
  async getBills(params?: Record<string, any>): Promise<PaginatedResult<SupplierBill>> {
    const res = await api.get('/accounting/bills', { params });
    return res.data;
  },

  async getBill(id: string): Promise<SupplierBill> {
    const res = await api.get(`/accounting/bills/${id}`);
    return res.data;
  },

  async createBill(data: Partial<SupplierBill>): Promise<SupplierBill> {
    const res = await api.post('/accounting/bills', data);
    return res.data;
  },

  async updateBill(id: string, data: Partial<SupplierBill>): Promise<SupplierBill> {
    const res = await api.put(`/accounting/bills/${id}`, data);
    return res.data;
  },

  async postBill(id: string): Promise<{ message: string; bill: SupplierBill }> {
    const res = await api.post(`/accounting/bills/${id}/post`);
    return res.data;
  },

  async recordPayment(billId: string, paymentData: {
    amount: number;
    date?: string;
    paymentMethod?: string;
    paymentAccount?: string;
    reference?: string;
    notes?: string;
  }): Promise<{ message: string; bill: SupplierBill }> {
    const res = await api.post(`/accounting/bills/${billId}/payments`, paymentData);
    return res.data;
  },

  async reverseBill(id: string, reason: string): Promise<{ message: string; bill: SupplierBill }> {
    const res = await api.post(`/accounting/bills/${id}/reverse`, { reason });
    return res.data;
  },

  // ── Journal Entries ──────────────────────────────────────────────────────
  async getJournalEntries(params?: Record<string, any>): Promise<PaginatedResult<JournalEntry>> {
    const res = await api.get('/accounting/journal-entries', { params });
    return res.data;
  },

  async createJournalEntry(data: {
    date?: string;
    reference?: string;
    description: string;
    lines: JournalLine[];
  }): Promise<JournalEntry> {
    const res = await api.post('/accounting/journal-entries', data);
    return res.data;
  },

  async reverseJournalEntry(id: string, reason: string): Promise<{ message: string; reversalEntry: JournalEntry }> {
    const res = await api.post(`/accounting/journal-entries/${id}/reverse`, { reason });
    return res.data;
  }
};

export default accountingService;
