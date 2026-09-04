import api from './api';

export interface ComplianceConfig {
  hasCertificate: boolean;
  verifactuEnabled: boolean;
  siiEnabled: boolean;
  certificateExpiry?: string;
  certificateSubject?: string;
}

export const complianceService = {
  getConfig: async (): Promise<ComplianceConfig> => {
    const res = await api.get('/compliance/config');
    return res.data;
  },

  updateConfig: async (payload: {
    verifactuEnabled?: boolean;
    siiEnabled?: boolean;
    pfxBase64?: string;
    password?: string;
  }): Promise<{ message: string }> => {
    const res = await api.post('/compliance/config', payload);
    return res.data;
  },

  getVerifactu: async () => {
    const res = await api.get('/compliance/verifactu');
    return res.data;
  },

  retryVerifactu: async (id: string) => {
    const res = await api.post(`/compliance/verifactu/${id}/retry`);
    return res.data;
  },

  getSii: async () => {
    const res = await api.get('/compliance/sii');
    return res.data;
  },

  retrySii: async (id: string) => {
    const res = await api.post(`/compliance/sii/${id}/retry`);
    return res.data;
  }
};
