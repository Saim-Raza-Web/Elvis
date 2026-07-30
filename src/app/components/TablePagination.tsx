import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '../../utils/listResponse';

interface TablePaginationProps {
  pagination: PaginationMeta | null;
  page: number;
  onPageChange: (page: number) => void;
}

export function TablePagination({ pagination, page, onPageChange }: TablePaginationProps) {
  if (!pagination || pagination.totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card text-sm">
      <span className="text-muted-foreground">
        Showing {(page - 1) * pagination.limit + 1}–{Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="p-1.5 rounded-lg border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 font-medium" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {page} / {pagination.totalPages}
        </span>
        <button
          type="button"
          disabled={page >= pagination.totalPages}
          onClick={() => onPageChange(page + 1)}
          className="p-1.5 rounded-lg border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
