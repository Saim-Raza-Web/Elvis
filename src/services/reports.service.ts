import api from './api';

export const reportsService = {
  exportPDF: async (reportType: string) => {
    const response = await api.post('/reports/export', { type: reportType });
    return response.data;
  },
  scheduleReport: async (data: any) => {
    const response = await api.post('/reports/schedule', data);
    return response.data;
  }
};
