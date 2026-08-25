import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export interface CustomerAddress {
  street?: string;
  number?: string;
  city?: string;
  postcode?: string;
  region?: string;
  country?: string;
}

export interface Customer {
  _id: string;
  id: string;
  name: string;
  contact?: string;
  email: string;
  phone?: string;
  vatNumber?: string;
  country?: string;
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
  paymentTerms?: string;
  iban?: string;
  bankInfo?: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  notes?: string;
  status: 'active' | 'inactive';
  active: boolean;
  orders: number;
  total_spend: number;
  last_activity?: string;
}

export const crmService = {
  getAll: async (params: Record<string, any> = {}) => fetchList('/crm', params),
  getPage: async (params: Record<string, any> = {}) => fetchPaginated('/crm', params),
  getById: async (id: string) => {
    const response = await api.get('/crm/' + id);
    return response.data;
  },
  create: async (data: Partial<Customer> | Record<string, any>) => {
    const response = await api.post('/crm', data);
    return response.data;
  },
  update: async (id: string, data: Partial<Customer> | Record<string, any>) => {
    const response = await api.put('/crm/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/crm/' + id);
    return response.data;
  }
};
