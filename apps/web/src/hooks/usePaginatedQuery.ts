import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { getIsOnlineSnapshot, NETWORK_FIRST_TIMEOUT_MS } from "@/lib/networkStatusStore";

export interface PageParams<TSort extends string, TFilters> {
  page: number; // 1-based
  pageSize: number;
  searchTerm: string;
  sortKey: TSort;
  sortDir: "asc" | "desc";
  filters: TFilters;
}

export interface PageResult<T> {
  rows: T[];
  totalCount: number;
}

interface UsePaginatedQueryOptions<T, TSort extends string, TFilters> {
  params: PageParams<TSort, TFilters>;
  // The offline/timeout/failure backstop -- and what renders first, always.
  // Expected to reuse each table's existing in-memory filter/sort verbatim,
  // just sliced to the requested page.
  queryLocal: (params: PageParams<TSort, TFilters>) => Promise<PageResult<T>>;
  // .select("*", { count: "exact" }) + .ilike()/.eq()/.order()/.range().
  fetchServer: (params: PageParams<TSort, TFilters>, signal: AbortSignal) => Promise<PageResult<T>>;
  // Same bulkPut-after-pending-filter convention as useNetworkFirstQuery's
  // writeBack -- keeps Dexie warm with whatever page was last viewed.
  writeBack: (rows: T[]) => Promise<void>;
  enabled?: boolean;
}

export interface PaginatedQueryResult<T> {
  rows: T[] | undefined; // undefined = first load in flight, same convention as useLiveQuery
  totalCount: number;
  totalPages: number;
}

// Dual-path pagination: a server .range() query when online, a local Dexie
// fallback (identical shape) when offline or when the server attempt times
// out/fails. Both paths return { rows, totalCount } so the calling page
// never branches on which path served it -- see usePaginatedQuery.ts's
// design note in the Phase 13 plan for the full rationale.
export function usePaginatedQuery<T, TSort extends string, TFilters>({
  params,
  queryLocal,
  fetchServer,
  writeBack,
  enabled = true,
}: UsePaginatedQueryOptions<T, TSort, TFilters>): PaginatedQueryResult<T> {
  // Only the free-text search debounces -- page/sort/filter changes stay as
  // instant as they are today; debouncing the whole params object would make
  // clicking "next page" feel laggy for no reason.
  const debouncedSearchTerm = useDebouncedValue(params.searchTerm, 300);
  const debouncedParams: PageParams<TSort, TFilters> = { ...params, searchTerm: debouncedSearchTerm };
  const rawKey = JSON.stringify(params);
  const debouncedKey = JSON.stringify(debouncedParams);

  const localResult = useLiveQuery(() => queryLocal(params), [rawKey]);

  const [serverResult, setServerResult] = useState<{ key: string; data: PageResult<T> } | null>(null);
  useEffect(() => {
    if (!enabled || !getIsOnlineSnapshot()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_FIRST_TIMEOUT_MS);
    fetchServer(debouncedParams, controller.signal)
      .then(async (data) => {
        setServerResult({ key: debouncedKey, data });
        await writeBack(data.rows);
      })
      .catch(() => {
        // Silent by design -- the local result is already rendering.
      })
      .finally(() => clearTimeout(timer));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, enabled]);

  // Only trust the server result once its key matches the CURRENT raw
  // params -- mid-debounce, or after the admin has since changed page/sort/
  // filter, this falls straight back to the local result. This is what
  // makes both paths transparent to the caller.
  const usingServer = serverResult?.key === rawKey;
  const active = usingServer ? serverResult.data : localResult;

  return {
    rows: active?.rows,
    totalCount: active?.totalCount ?? 0,
    totalPages: active ? Math.max(1, Math.ceil(active.totalCount / params.pageSize)) : 1,
  };
}
