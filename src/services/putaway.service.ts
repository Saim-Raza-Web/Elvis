import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const putawayService = {
  getAll: async (params = {}) => fetchList('/putaway', params),
  getPage: async (params = {}) => fetchPaginated('/putaway', params),
  getById: async (id: string) => {
    const response = await api.get('/putaway/' + id);
    return response.data;
  },
  assign: async (id: string, payload: { operatorEmail: string; __v?: number }) => {
    const response = await api.post(`/putaway/${id}/assign`, payload);
    return response.data;
  },
  start: async (id: string) => {
    const response = await api.post(`/putaway/${id}/start`);
    return response.data;
  },
  complete: async (id: string, payload: { destinationBin?: string; scannedTaskBarcode?: string; scannedBinBarcode?: string; __v?: number }) => {
    const response = await api.post(`/putaway/${id}/complete`, payload);
    return response.data;
  }
};
