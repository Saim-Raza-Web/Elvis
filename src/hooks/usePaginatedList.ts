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
  const [error, setError] = useState<Error | null>(null);

  const apiParamsKey = JSON.stringify(apiParams);
  const filterKey = `${apiParamsKey}:${JSON.stringify(deps)}`;

  // Sequence ref to prevent out-of-order stale network responses from overwriting current state
  const pageReqSeqRef = useRef(0);
  const allReqSeqRef = useRef(0);

  const reloadPage = useCallback(async () => {
    const currentSeq = ++pageReqSeqRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = { page, limit, ...apiParams };
      const result = await service.getPage(params);
      // Discard stale responses on slow or fluctuating PDA network connections
      if (currentSeq === pageReqSeqRef.current) {
        setItems(result.data);
        setPagination(result.pagination);
      }
    } catch (err: any) {
      if (currentSeq === pageReqSeqRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (currentSeq === pageReqSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [service, page, limit, apiParamsKey, ...deps]);

  const reloadAll = useCallback(async () => {
    if (!loadAllItems) return;
    const currentSeq = ++allReqSeqRef.current;
    try {
      const all = await service.getAll({ all: true, ...apiParams });
      if (currentSeq === allReqSeqRef.current) {
        setAllItems(all);
      }
    } catch {
      if (currentSeq === allReqSeqRef.current) {
        setAllItems([]);
      }
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
    error,
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
