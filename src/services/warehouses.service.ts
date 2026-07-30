import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const warehousesService = {
  getAll: async (params = {}) => fetchList('/warehouses', params),
  getPage: async (params = {}) => fetchPaginated('/warehouses', params),
  getById: async (id) => {
    const response = await api.get('/warehouses/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/warehouses', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/warehouses/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/warehouses/' + id);
    return response.data;
  }
};
