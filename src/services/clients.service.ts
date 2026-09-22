import api from './api';

export type ClientOwner = {
  _id: string;
  name: string;
  vat?: string;
  contact?: string;
  email?: string;
  phone?: string;
  active?: boolean;
  warehouseAccess?: string[];
  createdAt?: string;
};

export const clientsService = {
  getAll: async (params?: { active?: boolean }): Promise<ClientOwner[]> => {
    const response = await api.get('/clients', { params });
    return response.data;
  },
  create: async (data: Partial<ClientOwner>): Promise<ClientOwner> => {
    const response = await api.post('/clients', data);
    return response.data;
  },
  update: async (id: string, data: Partial<ClientOwner>): Promise<ClientOwner> => {
    const response = await api.put(`/clients/${id}`, data);
    return response.data;
  },
  delete: async (id: string): Promise<{ message: string }> => {
    const response = await api.delete(`/clients/${id}`);
    return response.data;
  }
};
