import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const leadsService = {
  getAll: async (params = {}) => fetchList('/leads', params),
  getPage: async (params = {}) => fetchPaginated('/leads', params),
  getById: async (id: string) => {
    const response = await api.get('/leads/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/leads', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/leads/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/leads/' + id);
    return response.data;
  }
};
