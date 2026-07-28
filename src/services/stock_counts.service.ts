import api from './api';

export const stockCountsService = {
  getAll: async () => {
    const response = await api.get('/stock-counts');
    return response.data;
  },
  
  getById: async (id: string) => {
    const response = await api.get(`/stock-counts/${id}`);
    return response.data;
  },

  create: async (data: any) => {
    const response = await api.post('/stock-counts', data);
    return response.data;
  },

  update: async (id: string, data: any) => {
    const response = await api.put(`/stock-counts/${id}`, data);
    return response.data;
  },
  
  delete: async (id: string) => {
    const response = await api.delete(`/stock-counts/${id}`);
    return response.data;
  }
};
