import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export const qcService = {
  getAll: async (params = {}) => fetchList('/qc', params),
  getPage: async (params = {}) => fetchPaginated('/qc', params),
  getById: async (id: string) => {
    const response = await api.get('/qc/' + id);
    return response.data;
  },
  startInspection: async (quarantineId: string) => {
    const response = await api.post('/qc', { quarantineId });
    return response.data;
  },
  updateInspection: async (id: string, data: any) => {
    const response = await api.put('/qc/' + id, data);
    return response.data;
  },
  passInspection: async (id: string, notes?: string) => {
    const response = await api.post('/qc/' + id + '/pass', { notes });
    return response.data;
  },
  failInspection: async (id: string, failReason: string) => {
    const response = await api.post('/qc/' + id + '/fail', { failReason });
    return response.data;
  },
  returnToVendor: async (id: string, data: { returnReason: string; rtvAuthNumber?: string; rtvCarrier?: string }) => {
    const response = await api.post('/qc/' + id + '/return', data);
    return response.data;
  }
};
