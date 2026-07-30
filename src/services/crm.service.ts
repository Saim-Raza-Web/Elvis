import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const crmService = {
  getAll: async (params = {}) => fetchList('/crm', params),
  getPage: async (params = {}) => fetchPaginated('/crm', params),
  getById: async (id) => {
    const response = await api.get('/crm/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/crm', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/crm/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/crm/' + id);
    return response.data;
  }
};
