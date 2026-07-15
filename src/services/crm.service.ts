import api from './api';

export const crmService = {
  getAll: async (params = {}) => {
    const response = await api.get('/crm', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/crm/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/crm', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/crm/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/crm/' + id);
    return response.data;
  }
};
