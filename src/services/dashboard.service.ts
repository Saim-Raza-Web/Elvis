import api from './api';

export const dashboardService = {
  getAll: async (params = {}) => {
    const response = await api.get('/dashboard', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/dashboard/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/dashboard', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/dashboard/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/dashboard/' + id);
    return response.data;
  }
};
