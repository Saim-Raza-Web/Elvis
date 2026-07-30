import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const asnService = {
  getAll: async (params = {}) => fetchList('/asn', params),
  getPage: async (params = {}) => fetchPaginated('/asn', params),
  getById: async (id) => {
    const response = await api.get('/asn/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/asn', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/asn/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/asn/' + id);
    return response.data;
  }
};
