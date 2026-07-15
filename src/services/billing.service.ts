import api from './api';

export const billingService = {
  getAll: async (params = {}) => {
    const response = await api.get('/billing', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/billing/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/billing', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/billing/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/billing/' + id);
    return response.data;
  }
};
