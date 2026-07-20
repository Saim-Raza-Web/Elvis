import api from './api';

export const settingsService = {
  getCompanySettings: async () => {
    const response = await api.get('/settings');
    return response.data;
  },
  updateCompanySettings: async (data: any) => {
    const response = await api.put('/settings', data);
    return response.data;
  }
};
