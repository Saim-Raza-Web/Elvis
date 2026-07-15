import api from './api';

export const settingsService = {
  getAll: async (params = {}) => {
    const response = await api.get('/settings', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/settings/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/settings', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/settings/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/settings/' + id);
    return response.data;
  }
};
