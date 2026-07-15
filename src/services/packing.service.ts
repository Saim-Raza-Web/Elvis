import api from './api';

export const packingService = {
  getAll: async (params = {}) => {
    const response = await api.get('/packing', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/packing/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/packing', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/packing/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/packing/' + id);
    return response.data;
  }
};
