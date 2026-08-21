import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const storageRulesService = {
  getAll: async (params = {}) => fetchList('/storage-rules', params),
  getPage: async (params = {}) => fetchPaginated('/storage-rules', params),
  getById: async (id: string) => {
    const response = await api.get('/storage-rules/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/storage-rules', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/storage-rules/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/storage-rules/' + id);
    return response.data;
  },
  simulatePutaway: async (payload: any) => {
    const response = await api.post('/storage-rules/simulate-putaway', payload);
    return response.data;
  },
  simulatePicking: async (payload: any) => {
    const response = await api.post('/storage-rules/simulate-picking', payload);
    return response.data;
  }
};
