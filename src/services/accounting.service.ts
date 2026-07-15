import api from './api';

export const accountingService = {
  getAll: async (params = {}) => {
    const response = await api.get('/accounting', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/accounting/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/accounting', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/accounting/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/accounting/' + id);
    return response.data;
  }
};
