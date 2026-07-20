import api from './api';

export const leadsService = {
  getAll: async (params = {}) => {
    const response = await api.get('/leads', { params });
    return response.data;
  },
  getById: async (id: string) => {
    const response = await api.get('/leads/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/leads', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/leads/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/leads/' + id);
    return response.data;
  }
};
