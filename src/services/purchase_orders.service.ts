import api from './api';

export interface PurchaseOrderLine {
  _id?: string;
  productId: string;
  sku: string;
  supplierSku?: string;
  description?: string;
  quantityOrdered: number;
  quantityReceived?: number;
  quantityBilled?: number;
  unitCost: number;
  taxRate?: number;
  lineSubtotal?: number;
  taxAmount?: number;
  lineTotal?: number;
}

export interface PurchaseOrder {
  _id: string;
  poNumber: string;
  supplierId: any;
  source?: string;
  sourceOrderId?: string;
  status: 'DRAFT' | 'CONFIRMED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'BILLED' | 'CANCELLED';
  expectedDeliveryDate?: string;
  currency?: string;
  warehouse?: string;
  notes?: string;
  supplierReference?: string;
  lines: PurchaseOrderLine[];
  subtotal?: number;
  taxTotal?: number;
  grandTotal?: number;
  createdAt?: string;
}

export const purchaseOrdersService = {
  getAll: async (): Promise<PurchaseOrder[]> => {
    const response = await api.get('/purchase-orders');
    return response.data;
  },
  getById: async (id: string): Promise<PurchaseOrder> => {
    const response = await api.get(`/purchase-orders/${id}`);
    return response.data;
  },
  create: async (data: Partial<PurchaseOrder>): Promise<PurchaseOrder> => {
    const response = await api.post('/purchase-orders', data);
    return response.data;
  },
  confirm: async (id: string): Promise<PurchaseOrder> => {
    const response = await api.post(`/purchase-orders/${id}/confirm`);
    return response.data;
  },
  cancel: async (id: string): Promise<PurchaseOrder> => {
    const response = await api.post(`/purchase-orders/${id}/cancel`);
    return response.data;
  },
  sendToSupplier: async (id: string): Promise<{ message: string, dispatchResult: any }> => {
    const response = await api.post(`/purchase-orders/${id}/send`);
    return response.data;
  },
  receiveGoods: async (id: string, receipts: { lineId: string; qty: number }[]): Promise<PurchaseOrder> => {
    const response = await api.post(`/purchase-orders/${id}/receive`, { receipts });
    return response.data;
  },
  createBill: async (id: string, data: { supplierInvoiceNumber: string; billDate?: string; dueDate?: string }): Promise<any> => {
    const response = await api.post(`/purchase-orders/${id}/bill`, data);
    return response.data;
  }
};

export default purchaseOrdersService;
