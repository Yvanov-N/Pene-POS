// Turns whatever was typed in the pagination box into a valid page: clamps to
// [1, totalPages], and falls back to the current page for an empty or
// non-numeric entry.
export function clampPage(input: string, currentPage: number, totalPages: number): number {
  const parsed = Number.parseInt(input, 10);
  if (Number.isNaN(parsed)) return currentPage;
  return Math.min(Math.max(1, parsed), Math.max(1, totalPages));
}
