import api from './api';

export const reportsService = {
  exportPDF: async (reportType: string) => {
    const response = await api.post('/reports/export', { type: reportType }, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${reportType}-report.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return response.data;
  },
  scheduleReport: async (data: any) => {
    const response = await api.post('/reports/schedule', data);
    return response.data;
  },
  getDashboardStats: async () => {
    const response = await api.get('/reports/dashboard');
    return response.data;
  },
  getWarehouseKPIs: async () => {
    const response = await api.get('/reports/warehouse-kpis');
    return response.data;
  }
};
