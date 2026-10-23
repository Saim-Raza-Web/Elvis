import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const returnsService = {
  getAll: async (params = {}) => fetchList('/returns', params),
  getPage: async (params = {}) => fetchPaginated('/returns', params),
  getById: async (id) => {
    const response = await api.get('/returns/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/returns', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/returns/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/returns/' + id);
    return response.data;
  },
  refund: async (id, data = {}, idempotencyKey = null) => {
    const headers = {};
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await api.post(`/returns/${id}/refund`, data, { headers });
    return response.data;
  }
};
