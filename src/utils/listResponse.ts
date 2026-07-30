export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type PaginatedResult<T> = {
  data: T[];
  pagination: PaginationMeta | null;
};

export function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && 'data' in body && Array.isArray((body as PaginatedResult<T>).data)) {
    return (body as PaginatedResult<T>).data;
  }
  return [];
}

export function unwrapPaginated<T>(body: unknown): PaginatedResult<T> {
  if (Array.isArray(body)) {
    return { data: body, pagination: null };
  }
  if (body && typeof body === 'object' && 'data' in body && Array.isArray((body as PaginatedResult<T>).data)) {
    const paginated = body as PaginatedResult<T>;
    return { data: paginated.data, pagination: paginated.pagination ?? null };
  }
  return { data: [], pagination: null };
}
