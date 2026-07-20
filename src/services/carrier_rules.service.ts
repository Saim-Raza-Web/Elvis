import api from './api';

export const carrierRulesService = {
  getAll: async (params = {}) => {
    const response = await api.get('/carrier-rules', { params });
    return response.data;
  },
  getById: async (id: string) => {
    const response = await api.get('/carrier-rules/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/carrier-rules', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/carrier-rules/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/carrier-rules/' + id);
    return response.data;
  }
};
