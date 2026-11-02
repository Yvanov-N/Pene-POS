import { useState } from "react";
import type { SortDir } from "@/lib/sorting";

// Column sort state for a table. Clicking the active column flips the
// direction; clicking another one starts at that column's natural first
// direction (`firstDir`, e.g. "desc" for amounts and dates, "asc" for text).
export function useTableSort<K extends string>(
  initialKey: K,
  initialDir: SortDir,
  firstDir: Partial<Record<K, SortDir>> = {},
  onChange?: () => void,
) {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const toggleSort = (key: K) => {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(firstDir[key] ?? "asc");
    }
    onChange?.();
  };

  // Direct pick (e.g. a "sort by" <select> on phones, where there are no headers).
  const setSort = (key: K, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
    onChange?.();
  };

  return { sortKey, sortDir, toggleSort, setSort };
}
