import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const inventoryService = {
  getAll: async (params = {}) => fetchList('/inventory', params),
  getPage: async (params = {}) => fetchPaginated('/inventory', params),
  getById: async (id) => {
    const response = await api.get('/inventory/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/inventory', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/inventory/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/inventory/' + id);
    return response.data;
  }
};
