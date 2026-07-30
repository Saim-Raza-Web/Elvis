import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const incidentsService = {
  getAll: async (params = {}) => fetchList('/incidents', params),
  getPage: async (params = {}) => fetchPaginated('/incidents', params),
  getById: async (id: string) => {
    const res = await api.get(`/incidents/${id}`);
    return res.data;
  },
  create: async (data: any) => {
    const res = await api.post('/incidents', data);
    return res.data;
  },
  update: async (id: string, data: any) => {
    const res = await api.put(`/incidents/${id}`, data);
    return res.data;
  },
  delete: async (id: string) => {
    const res = await api.delete(`/incidents/${id}`);
    return res.data;
  }
};
