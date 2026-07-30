import api from './api';
import { unwrapList, unwrapPaginated, type PaginatedResult } from '../utils/listResponse';

export { unwrapList, unwrapPaginated };
export type { PaginatedResult };

export async function fetchList<T>(url: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const response = await api.get(url, { params });
  return unwrapList<T>(response.data);
}

export async function fetchPaginated<T>(
  url: string,
  params: Record<string, unknown> = {}
): Promise<PaginatedResult<T>> {
  const response = await api.get(url, { params });
  return unwrapPaginated<T>(response.data);
}
