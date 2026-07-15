import api from './api';

export const locationsService = {
  getAll: async (params = {}) => {
    const response = await api.get('/locations', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/locations/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/locations', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/locations/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/locations/' + id);
    return response.data;
  }
};
