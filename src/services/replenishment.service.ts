import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const replenishmentService = {
  getAll: async (params = {}) => fetchList('/replenishment/tasks', params),
  getPage: async (params = {}) => fetchPaginated('/replenishment/tasks', params),
  getById: async (id: string) => {
    const response = await api.get('/replenishment/tasks/' + id);
    return response.data;
  },
  evaluateWarehouse: async (warehouse: string, dryRun = false) => {
    const response = await api.post('/replenishment/evaluate', { warehouse, dryRun });
    return response.data;
  },
  reserveReplenishment: async (data: any) => {
    const response = await api.post('/replenishment/reserve', data);
    return response.data;
  },
  completeReplenishment: async (id: string, scanVerification: any) => {
    const response = await api.post('/replenishment/' + id + '/complete', scanVerification);
    return response.data;
  },
  cancelReplenishment: async (id: string) => {
    const response = await api.post('/replenishment/' + id + '/cancel');
    return response.data;
  }
};
