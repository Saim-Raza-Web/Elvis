import api from './api';
import type { PaginatedResult } from './listApi';
import type { PaginationMeta } from '../utils/listResponse';

export type AccountingListResult = {
  transactions: PaginatedResult<Record<string, unknown>>;
  accounts: { name: string; balance: number; change: number }[];
};

function parseAccountingResponse(body: unknown): AccountingListResult {
  const payload = body as {
    transactions?: PaginatedResult<Record<string, unknown>> | Record<string, unknown>[];
    accounts?: AccountingListResult['accounts'];
  };

  if (payload.transactions && !Array.isArray(payload.transactions) && 'data' in payload.transactions) {
    return {
      transactions: {
        data: payload.transactions.data,
        pagination: payload.transactions.pagination ?? null,
      },
      accounts: payload.accounts ?? [],
    };
  }

  const list = Array.isArray(payload.transactions)
    ? payload.transactions
    : Array.isArray(payload)
      ? payload
      : [];

  return {
    transactions: { data: list, pagination: null },
    accounts: payload.accounts ?? [],
  };
}

export const accountingService = {
  getAll: async (params: Record<string, unknown> = {}) => {
    const response = await api.get('/accounting', { params: { ...params, all: true } });
    return parseAccountingResponse(response.data);
  },
  getPage: async (params: Record<string, unknown> = {}): Promise<AccountingListResult> => {
    const response = await api.get('/accounting', { params });
    return parseAccountingResponse(response.data);
  },
  getById: async (id: string) => {
    const response = await api.get('/accounting/' + id);
    return response.data;
  },
  create: async (data: Record<string, unknown>) => {
    const response = await api.post('/accounting', data);
    return response.data;
  },
  update: async (id: string, data: Record<string, unknown>) => {
    const response = await api.put('/accounting/' + id, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete('/accounting/' + id);
    return response.data;
  },
};

export type { PaginationMeta };
