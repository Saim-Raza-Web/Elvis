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
  name: string;
  category: string;
  balance: number;
  debitTotal: number;
  creditTotal: number;
  change: number;
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

function parseAccountingResponse(body: unknown): AccountingListResult {
  const payload = body as {
    transactions?: PaginatedResult<Record<string, unknown>> | Record<string, unknown>[];
    accounts?: AccountItem[];
    stats?: AccountingListResult['stats'];
  };

  if (payload.transactions && !Array.isArray(payload.transactions) && 'data' in payload.transactions) {
    return {
      transactions: {
        data: payload.transactions.data,
        pagination: payload.transactions.pagination ?? null,
      },
      accounts: payload.accounts ?? [],
      stats: payload.stats
    };
  }

  const list = Array.isArray(payload.transactions)
    ? payload.transactions
    : Array.isArray(payload)
      ? payload
      : [];

  return {
    transactions: { data: list, pagination: null },
    accounts: payload.accounts ?? [],
    stats: payload.stats
  };
}

export const accountingService = {
  // Overview & Ledger
  getAll: async (params: Record<string, unknown> = {}) => {
    const response = await api.get('/accounting', { params: { ...params, all: true } });
    return parseAccountingResponse(response.data);
  },
  getPage: async (params: Record<string, unknown> = {}): Promise<AccountingListResult> => {
    const response = await api.get('/accounting', { params });
    return parseAccountingResponse(response.data);
  },

  // Supplier Bills
  getBills: async (params: Record<string, unknown> = {}) => {
    const response = await api.get('/accounting/bills', { params });
    return response.data;
  },
  getBillById: async (id: string): Promise<SupplierBill> => {
    const response = await api.get(`/accounting/bills/${id}`);
    return response.data;
  },
  createBill: async (data: Partial<SupplierBill>) => {
    const response = await api.post('/accounting/bills', data);
    return response.data;
  },
  updateBill: async (id: string, data: Partial<SupplierBill>) => {
    const response = await api.put(`/accounting/bills/${id}`, data);
    return response.data;
  },
  postBill: async (id: string) => {
    const response = await api.post(`/accounting/bills/${id}/post`);
    return response.data;
  },
  payBill: async (id: string, data: { amount: number; paymentMethod?: string; paymentAccount?: string; reference?: string; notes?: string; date?: string }) => {
    const response = await api.post(`/accounting/bills/${id}/pay`, data);
    return response.data;
  },
  reverseBill: async (id: string, data: { reason?: string }) => {
    const response = await api.post(`/accounting/bills/${id}/reverse`, data);
    return response.data;
  },
  deleteBill: async (id: string) => {
    const response = await api.delete(`/accounting/bills/${id}`);
    return response.data;
  },

  // Journal Entries
  getJournalEntries: async (params: Record<string, unknown> = {}) => {
    const response = await api.get('/accounting/journal-entries', { params });
    return response.data;
  },
  getJournalEntryById: async (id: string): Promise<JournalEntry> => {
    const response = await api.get(`/accounting/journal-entries/${id}`);
    return response.data;
  },
  createJournalEntry: async (data: Partial<JournalEntry>) => {
    const response = await api.post('/accounting/journal-entries', data);
    return response.data;
  },
  reverseJournalEntry: async (id: string, data: { reason?: string }) => {
    const response = await api.post(`/accounting/journal-entries/${id}/reverse`, data);
    return response.data;
  },
};

export type { PaginationMeta };
