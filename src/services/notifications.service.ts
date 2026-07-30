import api from './api';

export const notificationsService = {
  getNotifications: async () => {
    const response = await api.get('/notifications');
    return response.data;
  },
  markRead: async (id: string) => {
    const response = await api.put('/notifications/' + id + '/read');
    return response.data;
  },
  markAllRead: async () => {
    const response = await api.put('/notifications/read-all');
    return response.data;
  }
};
