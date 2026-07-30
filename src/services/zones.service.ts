import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const zonesService = {
  getAll: async (params = {}) => fetchList('/zones', params),
  getPage: async (params = {}) => fetchPaginated('/zones', params),
  getById: async (id: string) => {
    const response = await api.get('/zones/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/zones', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/zones/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/zones/' + id);
    return response.data;
  }
};
