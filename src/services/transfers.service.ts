import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const transfersService = {
  getAll: async (params = {}) => fetchList('/transfers', params),
  getPage: async (params = {}) => fetchPaginated('/transfers', params),
  getById: async (id) => {
    const response = await api.get('/transfers/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/transfers', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/transfers/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/transfers/' + id);
    return response.data;
  }
};
