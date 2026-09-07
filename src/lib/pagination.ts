export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Slices `items` into a zero-indexed page, clamping out-of-range page numbers. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  const start = clamped * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: clamped,
    pageCount,
    hasPrev: clamped > 0,
    hasNext: clamped < pageCount - 1,
  };
}
