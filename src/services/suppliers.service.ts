import api from './api';

export type Supplier = {
  _id: string;
  name: string;
  taxId?: string;
  country?: string;
  contact?: string;
  email?: string;
  phone?: string;
  defaultCarrier?: string;
  leadTime?: number;
};

export const suppliersService = {
  getAll: async (params?: Record<string, unknown>): Promise<Supplier[]> => {
    const response = await api.get('/suppliers', { params });
    return Array.isArray(response.data) ? response.data : ((response.data as any)?.suppliers || []);
  },
  create: async (data: Partial<Supplier>): Promise<Supplier> => {
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
