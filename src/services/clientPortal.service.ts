import api from './api';

export interface ClientPortalInventoryItem {
  id: string;
  sku: string;
  productName: string;
  lot: string;
  expiryDate?: string;
  warehouse: string;
  location: string;
  locationType: string;
  qtyAvailable: number;
  qtyReserved: number;
  qtyAwaitingPutaway: number;
  updatedAt: string;
}

export interface ClientPortalOrder {
  id: string;
  orderId: string;
  order_type: 'B2C' | 'B2B';
  status: string;
  date: string;
  itemsCount: number;
  lines: any[];
  total: number;
  tracking_number?: string;
  carrier?: string;
  customerName?: string;
}

export interface ClientPortalAsn {
  id: string;
  asnId: string;
  poNumber: string;
  supplier: string;
  carrier?: string;
  status: string;
  expectedDate: string;
  warehouse: string;
  receivingDock: string;
  expectedUnits: number;
  receivedUnits: number;
  items: any[];
}

export const clientPortalService = {
  getProfile: async () => {
    const res = await api.get('/client-portal/profile');
    return res.data;
  },
  getInventory: async (params: Record<string, any> = {}) => {
    const res = await api.get('/client-portal/inventory', { params });
    return res.data;
  },
  getOrders: async (params: Record<string, any> = {}) => {
    const res = await api.get('/client-portal/orders', { params });
    return res.data;
  },
  createOrder: async (data: Record<string, any>) => {
    const res = await api.post('/client-portal/orders', data);
    return res.data;
  },
  getAsns: async (params: Record<string, any> = {}) => {
    const res = await api.get('/client-portal/asns', { params });
    return res.data;
  },
  createAsn: async (data: Record<string, any>) => {
    const res = await api.post('/client-portal/asns', data);
    return res.data;
  },
  getBilling: async (params: Record<string, any> = {}) => {
    const res = await api.get('/client-portal/billing', { params });
    return res.data;
  },
  getKpis: async () => {
    const res = await api.get('/client-portal/kpis');
    return res.data;
  }
};
