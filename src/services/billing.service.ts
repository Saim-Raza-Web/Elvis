import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export interface InvoiceLine {
  itemType: 'product' | 'service';
  productId?: string;
  sku?: string;
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

export interface InvoicePayload {
  customerId: string;
  lines: InvoiceLine[];
  issuedDate?: string;
  dueDate?: string;
  paymentTerms?: string;
  notes?: string;
  bankInfo?: string;
  status?: 'draft' | 'issued';
}

export const billingService = {
  getAll: async (params: Record<string, any> = {}) => fetchList('/billing', params),
  getPage: async (params: Record<string, any> = {}) => fetchPaginated('/billing', params),
  getById: async (id: string) => {
    const response = await api.get('/billing/' + id);
    return response.data;
  },
  create: async (data: InvoicePayload | Record<string, any>) => {
    const response = await api.post('/billing', data);
    return response.data;
  },
  update: async (id: string, data: Partial<InvoicePayload> | Record<string, any>) => {
    const response = await api.put('/billing/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/billing/' + id);
    return response.data;
  },
  issueInvoice: async (id: string) => {
    const response = await api.post(`/billing/${id}/issue`);
    return response.data;
  },
  sendInvoice: async (id: string, simulateFailure = false) => {
    const response = await api.post(`/billing/${id}/send`, { simulateFailure });
    return response.data;
  },
  markPaid: async (id: string) => {
    const response = await api.post(`/billing/${id}/pay`);
    return response.data;
  },
  cancelInvoice: async (id: string) => {
    const response = await api.post(`/billing/${id}/cancel`);
    return response.data;
  },
  downloadPdf: async (id: string, filename?: string) => {
    const response = await api.get(`/billing/${id}/pdf`, {
      responseType: 'blob'
    });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `invoice-${id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return true;
  },

  // ── 3PL Billing, Rate Cards & 20-Day Rule ──
  getRateCards: async (params: Record<string, any> = {}) => {
    const response = await api.get('/3pl/billing/rate-cards', { params });
    return response.data;
  },
  getRateCardById: async (id: string) => {
    const response = await api.get(`/3pl/billing/rate-cards/${id}`);
    return response.data;
  },
  saveRateCard: async (data: Record<string, any>) => {
    const response = await api.post('/3pl/billing/rate-cards', data);
    return response.data;
  },
  updateRateCard: async (id: string, data: Record<string, any>) => {
    const response = await api.put(`/3pl/billing/rate-cards/${id}`, data);
    return response.data;
  },
  deleteRateCard: async (id: string) => {
    const response = await api.delete(`/3pl/billing/rate-cards/${id}`);
    return response.data;
  },
  calculate3pl: async (payload: { client: string; year: number; month: number; warehouse?: string }) => {
    const response = await api.post('/3pl/billing/calculate', payload);
    return response.data;
  },
  get3plSummary: async (params: Record<string, any> = {}) => {
    const response = await api.get('/3pl/billing/summary', { params });
    return response.data;
  },
  evaluate20DayRule: async () => {
    const response = await api.post('/3pl/billing/evaluate-20-day-rule');
    return response.data;
  },
  download3plPdf: async (payload: { client: string; year: number; month: number; warehouse?: string }, filename?: string) => {
    const response = await api.post('/3pl/billing/export/pdf', payload, { responseType: 'blob' });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `liquidacio-3pl-${payload.client}-${payload.year}-${payload.month}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return true;
  },
  download3plCsv: async (payload: { client: string; year: number; month: number; warehouse?: string }, filename?: string) => {
    const response = await api.post('/3pl/billing/export/csv', payload, { responseType: 'blob' });
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `liquidacio-3pl-${payload.client}-${payload.year}-${payload.month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return true;
  }
};
