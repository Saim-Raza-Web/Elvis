import api from './api';
import { fetchList, fetchPaginated, unwrapList } from './listApi';

export const pickingService = {
  getAll: async (params = {}) => fetchList('/picking', params),
  getPage: async (params = {}) => fetchPaginated('/picking', params),
  getById: async (id: string) => {
    const response = await api.get('/picking/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/picking', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/picking/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/picking/' + id);
    return response.data;
  },
  getBatches: async (params = {}) => {
    const response = await api.get('/picking/batches', { params: { ...params, all: true } });
    return unwrapList(response.data);
  },
  getBatchesPage: async (params = {}) => fetchPaginated('/picking/batches', params),
  createBatch: async (data: any) => {
    const response = await api.post('/picking/batches', data);
    return response.data;
  },
  updateBatch: async (id: string, data: any) => {
    const response = await api.put('/picking/batches/' + id, data);
    return response.data;
  }
};
