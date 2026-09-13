import api from './api';
import { fetchList, fetchPaginated } from './listApi';

export interface ExpiryAlertItem {
  _id: string;
  company: string;
  warehouse: string;
  sku: string;
  lotNumber: string;
  expiryDate: string;
  category: string;
  severity: 'WARNING' | 'HIGH' | 'CRITICAL' | 'EXPIRED';
  daysRemaining: number;
  thresholdBreached: 'T_ALERT' | 'T_BLOCK' | 'T_WITHDRAWAL' | 'EXPIRED';
  actionRequired: string;
  qtyAvailable: number;
  qtyReserved: number;
  qtyAwaitingPutaway: number;
  qtyQuarantine: number;
  totalQty: number;
  locations: Array<{
    bin: string;
    qtyAvailable: number;
    qtyReserved: number;
    qtyAwaitingPutaway: number;
    qtyQuarantine: number;
    totalQty: number;
  }>;
  owner: string;
  ownerType: 'COMPANY' | 'CUSTOMER' | 'UNKNOWN';
  isRecalled: boolean;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';
  acknowledgedAt?: string;
  acknowledgedByName?: string;
  acknowledgementNote?: string;
  resolvedAt?: string;
  resolvedByName?: string;
  resolutionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export const expiryAlertsService = {
  getAll: async (params = {}) => fetchList('/expiry-alerts', params),
  getPage: async (params = {}) => fetchPaginated('/expiry-alerts', params),
  getById: async (id: string) => {
    const response = await api.get('/expiry-alerts/' + id);
    return response.data;
  },
  triggerScan: async (payload: { warehouse?: string; dryRun?: boolean; evaluationNow?: string } = {}) => {
    const response = await api.post('/expiry-alerts/scan', payload);
    return response.data;
  },
  acknowledge: async (id: string, note?: string) => {
    const response = await api.post(`/expiry-alerts/${id}/acknowledge`, { note });
    return response.data;
  },
  resolve: async (id: string, reason?: string) => {
    const response = await api.post(`/expiry-alerts/${id}/resolve`, { reason });
    return response.data;
  },
  dismiss: async (id: string, reason?: string) => {
    const response = await api.post(`/expiry-alerts/${id}/dismiss`, { reason });
    return response.data;
  },
  runWorker: async (payload: { warehouse?: string; dryRun?: boolean; evaluationNow?: string } = {}) => {
    const response = await api.post('/expiry-alerts/run-worker', payload);
    return response.data;
  }
};
