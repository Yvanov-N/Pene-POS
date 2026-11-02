// Turns whatever was typed in the pagination box into a valid page: clamps to
// [1, totalPages], and falls back to the current page for an empty or
// non-numeric entry.
export function clampPage(input: string, currentPage: number, totalPages: number): number {
  const parsed = Number.parseInt(input, 10);
  if (Number.isNaN(parsed)) return currentPage;
  return Math.min(Math.max(1, parsed), Math.max(1, totalPages));
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

// Client-side slice for lists that are already fully in memory.
export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  return { rows: rows.slice(offset, offset + pageSize), totalPages };
}
