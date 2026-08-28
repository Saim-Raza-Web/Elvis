import api from './api';

export interface IntegrationProviderInfo {
  code: string;
  name: string;
  logo?: string;
  authType: 'OAUTH2' | 'API_KEY' | 'TOKEN';
  connectionMethod: 'oauth_redirect' | 'token' | 'api_credentials' | 'partner_authorization';
  isProductionConfigured: boolean;
  supportsOAuth: boolean;
  supportsWebhooks: boolean;
  supportsProductSync: boolean;
  supportsOrderSync: boolean;
  supportsInventorySync: boolean;
  inventoryDirections: Array<'wms_to_store' | 'store_to_wms' | 'manual_only'>;
  requiredCredentials?: string[];
  requiredFields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    required: boolean;
  }>;
  supportedShopTypes?: string[];
  supportedRegions?: string[];
  supportedSites?: Record<string, Array<{ id: string; label: string }>>;
  productionRequirements?: string;
  guideTitle?: string;
  guideSteps?: string[];
  guideNotes?: string[];
  description?: string;
}

export interface SyncSettings {
  syncProducts: boolean;
  syncOrders: boolean;
  syncInventory: boolean;
  inventoryDirection: 'wms_to_store' | 'store_to_wms' | 'manual_only';
  autoSyncIntervalMinutes: number;
  defaultWarehouse: string;
  orderPrefix: string;
}

export interface ConnectedStore {
  _id: string;
  id?: string;
  company: string;
  provider: 'SHOPIFY' | 'WOOCOMMERCE' | 'AMAZON' | 'EBAY' | 'TEMU' | 'MIRAVIA' | 'ALIEXPRESS' | 'TIKTOK_SHOP';
  storeName: string;
  customStoreName?: string;
  storeUrl: string;
  externalStoreId?: string;
  marketplace?: string;
  region?: string;
  country?: string;
  shopType?: string;
  connectionMethod?: 'oauth_redirect' | 'token' | 'api_credentials' | 'partner_authorization';
  isSandbox?: boolean;
  status: 'not_configured' | 'pending' | 'pending_authorization' | 'authorizing' | 'connected' | 'sandbox_connected' | 'syncing' | 'auth_expired' | 'error' | 'disconnected';
  authType: 'OAUTH2' | 'API_KEY' | 'TOKEN';
  scopes: string[];
  tokenExpiresAt?: string | null;
  syncSettings: SyncSettings;
  isSyncing: boolean;
  lastSyncAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
  lastError?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationSyncLog {
  _id: string;
  company: string;
  connectedStore: string;
  provider: string;
  syncType: 'product' | 'order' | 'inventory' | 'full';
  trigger: 'manual' | 'scheduled' | 'webhook';
  status: 'started' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  errorDetails: Array<{ item?: string; reason?: string }>;
  summary: string;
  createdAt: string;
}

export interface ConnectInitiateResponse {
  success: boolean;
  provider: string;
  authorizationUrl: string;
  method: string;
  isSandbox: boolean;
  state: string;
}

export interface SyncRunResponse {
  success: boolean;
  syncLogId: string;
  durationMs: number;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  summary: string;
}

export const integrationsService = {
  getProviders: async (): Promise<IntegrationProviderInfo[]> => {
    const res = await api.get<IntegrationProviderInfo[]>('/integrations/providers');
    return res.data;
  },

  getStores: async (params?: any): Promise<{ data: ConnectedStore[]; pagination: any }> => {
    const res = await api.get('/integrations/stores', { params });
    return res.data;
  },

  getStoreById: async (id: string): Promise<ConnectedStore> => {
    const res = await api.get<ConnectedStore>(`/integrations/stores/${id}`);
    return res.data;
  },

  initiateConnect: async (
    provider: string,
    payload: {
      customName?: string;
      region?: string;
      sites?: string[];
      shopDomain?: string;
      storeUrl?: string;
      redirectUri?: string;
      isSandbox?: boolean;
    }
  ): Promise<ConnectInitiateResponse> => {
    const res = await api.post<ConnectInitiateResponse>(`/integrations/${provider.toUpperCase()}/connect`, payload);
    return res.data;
  },

  connectWithToken: async (
    provider: string,
    payload: {
      customName: string;
      token: string;
      shopType?: string;
      siteCountry?: string;
      isSandbox?: boolean;
    }
  ): Promise<{ success: boolean; message: string; store: ConnectedStore }> => {
    const res = await api.post<{ success: boolean; message: string; store: ConnectedStore }>(`/integrations/${provider.toUpperCase()}/connect-token`, payload);
    return res.data;
  },

  updateSettings: async (id: string, payload: { storeName?: string; syncSettings?: Partial<SyncSettings> }): Promise<ConnectedStore> => {
    const res = await api.put<{ success: boolean; store: ConnectedStore }>(`/integrations/stores/${id}/settings`, payload);
    return res.data.store;
  },

  triggerSync: async (id: string, payload?: { syncType?: 'full' | 'product' | 'order' | 'inventory' }): Promise<SyncRunResponse> => {
    const res = await api.post<SyncRunResponse>(`/integrations/stores/${id}/sync`, payload || { syncType: 'full' });
    return res.data;
  },

  getSyncHistory: async (id: string, params?: any): Promise<{ data: IntegrationSyncLog[]; pagination: any }> => {
    const res = await api.get(`/integrations/stores/${id}/sync-history`, { params });
    return res.data;
  },

  disconnectStore: async (id: string): Promise<{ success: boolean; message: string }> => {
    const res = await api.post<{ success: boolean; message: string }>(`/integrations/stores/${id}/disconnect`);
    return res.data;
  },

  deleteStore: async (id: string): Promise<{ success: boolean; message: string }> => {
    const res = await api.delete<{ success: boolean; message: string }>(`/integrations/stores/${id}`);
    return res.data;
  }
};

export default integrationsService;

