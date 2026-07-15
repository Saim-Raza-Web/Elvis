import api from './api';

export const transfersService = {
  getAll: async (params = {}) => {
    const response = await api.get('/transfers', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/transfers/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/transfers', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/transfers/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/transfers/' + id);
    return response.data;
  }
};
