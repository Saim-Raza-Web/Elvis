import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const shippingService = {
  getAll: async (params: any = {}) => fetchList('/shipping', params),
  getPage: async (params: any = {}) => fetchPaginated('/shipping', params),
  getById: async (id: string) => {
    const response = await api.get('/shipping/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/shipping', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/shipping/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/shipping/' + id);
    return response.data;
  },
  groupOrders: async (data: any) => {
    const response = await api.post('/shipping/group-orders', data);
    return response.data;
  },
  signShipment: async (id: string, data: any) => {
    const response = await api.post('/shipping/' + id + '/sign', data);
    return response.data;
  },
  getMethods: async () => {
    const response = await api.get('/shipping/methods');
    return response.data;
  },
  generateLabel: async (id: string, data: any = {}) => {
    const response = await api.post('/shipping/' + id + '/generate-label', data);
    return response.data;
  },
  getTracking: async (id: string) => {
    const response = await api.get('/shipping/' + id + '/tracking');
    return response.data;
  },
  getRateQuote: async (data: any) => {
    const response = await api.post('/shipping/rate-quote', data);
    return response.data;
  },
  syncTracking: async (id: string) => {
    const response = await api.post('/shipping/' + id + '/sync-tracking');
    return response.data;
  }
};
