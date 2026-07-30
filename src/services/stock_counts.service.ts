import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const stockCountsService = {
  getAll: async (params = {}) => fetchList('/stock-counts', params),
  getPage: async (params = {}) => fetchPaginated('/stock-counts', params),
  
  getById: async (id: string) => {
    const response = await api.get(`/stock-counts/${id}`);
    return response.data;
  },

  create: async (data: any) => {
    const response = await api.post('/stock-counts', data);
    return response.data;
  },

  update: async (id: string, data: any) => {
    const response = await api.put(`/stock-counts/${id}`, data);
    return response.data;
  },
  
  delete: async (id: string) => {
    const response = await api.delete(`/stock-counts/${id}`);
    return response.data;
  }
};
