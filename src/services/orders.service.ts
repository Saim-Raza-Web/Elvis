import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const ordersService = {
  getAll: async (params = {}) => fetchList('/orders', params),
  getPage: async (params = {}) => fetchPaginated('/orders', params),
  getById: async (id: string) => {
    const response = await api.get('/orders/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/orders', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/orders/' + id, data);
    return response.data;
  },
  releaseOrder: async (id: string) => {
    const response = await api.post('/orders/' + id + '/release');
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/orders/' + id);
    return response.data;
  }
};
