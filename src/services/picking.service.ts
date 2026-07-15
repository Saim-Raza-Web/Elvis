import api from './api';

export const pickingService = {
  getAll: async (params = {}) => {
    const response = await api.get('/picking', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/picking/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/picking', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/picking/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/picking/' + id);
    return response.data;
  }
};
