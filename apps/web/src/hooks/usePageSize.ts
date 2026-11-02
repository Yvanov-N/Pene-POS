import { useState } from "react";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/pagination";

const STORAGE_PREFIX = "pene_pos.pageSize.";

function readStored(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_PREFIX + key));
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(stored) ? stored : fallback;
  } catch {
    // Private mode / blocked storage -- just use the default.
    return fallback;
  }
}

// Rows per page for one table, remembered on this device (a per-viewer
// preference, not shop data -- so localStorage, not Dexie/Supabase).
export function usePageSize(tableKey: string, defaultSize = DEFAULT_PAGE_SIZE): [number, (size: number) => void] {
  const [pageSize, setPageSizeState] = useState(() => readStored(tableKey, defaultSize));

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    try {
      localStorage.setItem(STORAGE_PREFIX + tableKey, String(size));
    } catch {
      // Not persisted this time; the choice still applies until reload.
    }
  };

  return [pageSize, setPageSize];
}
