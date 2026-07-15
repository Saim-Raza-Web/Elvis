import api from './api';

export const returnsService = {
  getAll: async (params = {}) => {
    const response = await api.get('/returns', { params });
    return response.data;
  },
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
  }
};
