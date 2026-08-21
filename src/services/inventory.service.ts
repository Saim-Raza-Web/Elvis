import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const inventoryService = {
  getAll: async (params = {}) => fetchList('/inventory', params),
  getPage: async (params = {}) => fetchPaginated('/inventory', params),
  getById: async (id: string) => {
    const response = await api.get('/inventory/' + id);
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/inventory', data);
    return response.data;
  },
  update: async (id: string, data: any) => {
    const response = await api.put('/inventory/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/inventory/' + id);
    return response.data;
  },
  resolveBarcode: async (barcode: string) => {
    const response = await api.get('/inventory/resolve-barcode/' + encodeURIComponent(barcode));
    return response.data;
  },
  searchProducts: async (query: string) => {
    const response = await api.get('/inventory/search?q=' + encodeURIComponent(query));
    return response.data;
  },
  recallLot: async (payload: { lotNumber: string; sku?: string; reason?: string }) => {
    const response = await api.post('/inventory/lots/recall', payload);
    return response.data;
  },
  initialStockLoad: async (payload: any) => {
    const response = await api.post('/inventory/initial-stock-load', payload);
    return response.data;
  }
};
