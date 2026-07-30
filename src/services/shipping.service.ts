import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const shippingService = {
  getAll: async (params = {}) => fetchList('/shipping', params),
  getPage: async (params = {}) => fetchPaginated('/shipping', params),
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
