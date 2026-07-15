import api from './api';

export const shippingService = {
  getAll: async (params = {}) => {
    const response = await api.get('/shipping', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/shipping/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/shipping', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/shipping/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/shipping/' + id);
    return response.data;
  }
};
