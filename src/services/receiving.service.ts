import api from './api';

export const receivingService = {
  getAll: async (params = {}) => {
    const response = await api.get('/receiving', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/receiving/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/receiving', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/receiving/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/receiving/' + id);
    return response.data;
  }
};
