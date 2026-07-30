import { useState, useEffect, useCallback, useRef } from 'react';
import type { PaginationMeta } from '../utils/listResponse';
import { fetchList, fetchPaginated, type PaginatedResult } from '../services/listApi';

export type ListService<T> = {
  getPage: (params?: Record<string, unknown>) => Promise<PaginatedResult<T>>;
  getAll: (params?: Record<string, unknown>) => Promise<T[]>;
};

export function usePaginatedList<T>(
  service: ListService<T>,
  options: {
    limit?: number;
    apiParams?: Record<string, unknown>;
    deps?: unknown[];
    /** Fetch full dataset for stats/export (refreshes when filters change, not on page change). */
    loadAllItems?: boolean;
  } = {}
) {
  const { limit = 25, apiParams = {}, deps = [], loadAllItems = true } = options;
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<T[]>([]);
  const [allItems, setAllItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const apiParamsKey = JSON.stringify(apiParams);
  const filterKey = `${apiParamsKey}:${JSON.stringify(deps)}`;

  const reloadPage = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = { page, limit, ...apiParams };
      const result = await service.getPage(params);
      setItems(result.data);
      setPagination(result.pagination);
    } finally {
      setIsLoading(false);
    }
  }, [service, page, limit, apiParamsKey, ...deps]);

  const reloadAll = useCallback(async () => {
    if (!loadAllItems) return;
    try {
      const all = await service.getAll({ all: true, ...apiParams });
      setAllItems(all);
    } catch {
      setAllItems([]);
    }
  }, [service, loadAllItems, apiParamsKey, ...deps]);

  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      setPage(1);
    }
  }, [filterKey]);

  useEffect(() => {
    reloadPage();
  }, [reloadPage]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  const reload = useCallback(async () => {
    await Promise.all([reloadPage(), reloadAll()]);
  }, [reloadPage, reloadAll]);

  return {
    items,
    setItems,
    allItems,
    pagination,
    page,
    setPage,
    isLoading,
    reload,
    total: pagination?.total ?? 0,
  };
}

/** Convenience wrapper when service only has URL-based fetch helpers */
export function createListService<T>(basePath: string): ListService<T> {
  return {
    getAll: (params = {}) => fetchList<T>(basePath, params),
    getPage: (params = {}) => fetchPaginated<T>(basePath, params),
  };
}
