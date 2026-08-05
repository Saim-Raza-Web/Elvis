import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const receivingService = {
  getAll: async (params = {}) => fetchList('/receiving', params),
  getPage: async (params = {}) => fetchPaginated('/receiving', params),
  getById: async (id: string) => {
    const response = await api.get('/receiving/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/receiving', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/receiving/' + id, data);
    return response.data;
  },
  updateStatus: async (id: string, status: string) => {
    const response = await api.patch('/receiving/' + id + '/status', { status });
    return response.data;
  },
  receiveGoods: async (id: string, payload: any) => {
    const response = await api.post('/receiving/' + id + '/receive', payload);
    return response.data;
  },
  getHistory: async (id: string) => {
    const response = await api.get('/receiving/' + id + '/history');
    return response.data;
  },
  getDiscrepancies: async (id: string) => {
    const response = await api.get('/receiving/' + id + '/discrepancies');
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/receiving/' + id);
    return response.data;
  }
};
