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

  // Always the reactive, Dexie-backed value -- rows render from this and
  // ONLY this, so any local write (this page's own edit, another tab's, or
  // the fetch below writing a fresher page into Dexie) shows up the instant
  // useLiveQuery re-runs. Never shadowed by a one-time server snapshot --
  // that was the earlier bug here (see Phase 15): once a server fetch
  // landed, its frozen rows kept rendering forever, silently ignoring every
  // subsequent local edit until something changed page/search/sort/filter
  // or the whole page was reloaded.
  const localResult = useLiveQuery(() => queryLocal(params), [rawKey]);

  // The one thing local data can legitimately be missing is an accurate
  // GLOBAL count on a large/partially-synced table -- that's the only
  // reason to trust the server over local here, never for the rows.
  const [serverCount, setServerCount] = useState<{ key: string; totalCount: number } | null>(null);
  useEffect(() => {
    if (!enabled || !getIsOnlineSnapshot()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_FIRST_TIMEOUT_MS);
    fetchServer(debouncedParams, controller.signal)
      .then(async (data) => {
        setServerCount({ key: debouncedKey, totalCount: data.totalCount });
        await writeBack(data.rows);
      })
      .catch(() => {
        // Silent by design -- the local result is already rendering.
      })
      .finally(() => clearTimeout(timer));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, enabled]);

  // Only trust the server count once its key matches the CURRENT raw params
  // -- mid-debounce, or after the admin has since changed page/sort/filter,
  // this falls straight back to what queryLocal already computed.
  const totalCount = serverCount?.key === rawKey ? serverCount.totalCount : (localResult?.totalCount ?? 0);

  return {
    rows: localResult?.rows,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / params.pageSize)),
  };
}
