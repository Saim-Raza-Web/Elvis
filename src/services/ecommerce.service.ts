import api from './api';

export const ecommerceService = {
  getAll: async (params = {}) => {
    const response = await api.get('/ecommerce', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/ecommerce/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/ecommerce', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/ecommerce/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/ecommerce/' + id);
    return response.data;
  }
};
