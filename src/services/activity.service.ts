import api from './api';

export const activityService = {
  getAll: async (params = {}) => {
    const response = await api.get('/activity', { params });
    return response.data;
  },
  getNotifications: async () => {
    const response = await api.get('/activity/notifications');
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get('/activity/' + id);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/activity', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put('/activity/' + id, data);
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete('/activity/' + id);
    return response.data;
  }
};
