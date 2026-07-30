import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const carriersService = {
  getAll: async (params = {}) => fetchList('/carriers', params),
  getPage: async (params = {}) => fetchPaginated('/carriers', params),
  getById: async (id) => {
    const response = await api.get('/carriers/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/carriers', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/carriers/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/carriers/' + id);
    return response.data;
  }
};
