import api from './api';

export const settingsService = {
  getCompanySettings: async () => {
    const response = await api.get('/settings');
    return response.data;
  },
  updateCompanySettings: async (data: any) => {
    const response = await api.put('/settings', data);
    return response.data;
  },
  createApiKey: async (name: string) => {
    const response = await api.post('/settings/apikeys', { name });
    return response.data;
  },
  deleteApiKey: async (id: string) => {
    const response = await api.delete('/settings/apikeys/' + id);
    return response.data;
  }
};
