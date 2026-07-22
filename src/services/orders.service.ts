import api from './api';

export const ordersService = {
  getAll: async (params = {}) => {
    const response = await api.get('/orders', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/orders/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/orders', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/orders/' + id, data);
    return response.data;
  },
  releaseOrder: async (id: string) => {
    const response = await api.post('/orders/' + id + '/release');
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/orders/' + id);
    return response.data;
  }
};
