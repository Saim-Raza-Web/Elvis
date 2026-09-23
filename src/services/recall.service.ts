import api from './api';

export const recallService = {
  previewRecall: async (params: { lotNumber: string; sku?: string; warehouse?: string; owner?: string }) => {
    const response = await api.get('/lot-recalls/preview', { params });
    return response.data;
  },
  getShippedReport: async (params: { lotNumber: string; sku?: string; warehouse?: string; owner?: string }) => {
    const response = await api.get('/lot-recalls/shipped-report', { params });
    return response.data;
  },
  executeRecall: async (data: {
    lotNumber: string;
    sku?: string;
    warehouse?: string;
    owner?: string;
    quantity?: number;
    reason?: string;
    recallId?: string;
  }) => {
    const response = await api.post('/lot-recalls', data);
    return response.data;
  },
  getRecallHistory: async (params = {}) => {
    const response = await api.get('/lot-recalls', { params });
    return response.data;
  }
};
