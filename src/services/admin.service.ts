import api from './api';

export const adminService = {
  getUsers: async () => {
    const response = await api.get('/admin/users');
    return response.data;
  },
  getCompanies: async () => {
    const response = await api.get('/admin/companies');
    return response.data;
  },
  createCompany: async (data: any) => {
    const response = await api.post('/admin/companies', data);
    return response.data;
  },
  updateCompany: async (id: string, data: any) => {
    const response = await api.put(`/admin/companies/${id}`, data);
    return response.data;
  },
  deleteCompany: async (id: string) => {
    const response = await api.delete(`/admin/companies/${id}`);
    return response.data;
  },
  getMetrics: async () => {
    const response = await api.get('/admin/metrics');
    return response.data;
  }
};