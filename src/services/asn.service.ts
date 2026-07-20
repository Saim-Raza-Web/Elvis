import api from './api';

export const asnService = {
  getAll: async (params = {}) => {
    const response = await api.get('/asn', { params });
    return response.data;
  },
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
