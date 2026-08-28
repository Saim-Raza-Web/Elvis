import api from './api';

export interface SupplierAddress {
  street?: string;
  number?: string;
  city?: string;
  postcode?: string;
  region?: string;
  country?: string;
}

export interface SupplierPaymentInfo {
  defaultPaymentTerms?: string;
  iban?: string;
  bankName?: string;
  swiftBic?: string;
  paymentNotes?: string;
}

export interface SupplierAccountingInfo {
  ledgerAccountId?: string | null;
  accountCode?: string;
  accountName?: string;
}

export interface SupplierMetrics {
  totalBills?: number;
  totalBilled?: number;
  totalPaid?: number;
  outstandingBalance?: number;
}

export type Supplier = {
  _id: string;
  name: string;
  supplierType?: string;
  taxId?: string;
  country?: string;
  taxRegistrationNotes?: string;
  contact?: string;
  email?: string;
  phone?: string;
  website?: string;
  billingAddress?: SupplierAddress;
  shippingAddress?: SupplierAddress;
  paymentInfo?: SupplierPaymentInfo;
  accountingInfo?: SupplierAccountingInfo;
  defaultCarrier?: string;
  preferredCarrier?: string;
  leadTime?: number;
  notes?: string;
  active?: boolean;
  metrics?: SupplierMetrics;
  createdAt?: string;
  updatedAt?: string;
};

export const suppliersService = {
  getAll: async (params?: Record<string, unknown>): Promise<Supplier[]> => {
    const response = await api.get('/suppliers', { params });
    return Array.isArray(response.data) ? response.data : ((response.data as any)?.suppliers || []);
  },
  getById: async (id: string): Promise<Supplier> => {
    const response = await api.get(`/suppliers/${id}`);
    return response.data;
  },
  create: async (data: Partial<Supplier> & { createLedgerAccount?: boolean }): Promise<Supplier> => {
    const response = await api.post('/suppliers', data);
    return response.data;
  },
  update: async (id: string, data: Partial<Supplier>): Promise<Supplier> => {
    const response = await api.put(`/suppliers/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete(`/suppliers/${id}`);
    return response.data;
  },
};

export default suppliersService;
