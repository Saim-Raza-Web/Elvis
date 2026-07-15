import api from './api';

export const carriersService = {
  getAll: async (params = {}) => {
    const response = await api.get('/carriers', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/carriers/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/carriers', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/carriers/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/carriers/' + id);
    return response.data;
  }
};
