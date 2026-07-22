import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getIsOnlineSnapshot, NETWORK_FIRST_TIMEOUT_MS } from "@/lib/networkStatusStore";

interface NetworkFirstQueryOptions<TRemote> {
  fetchRemote: (signal: AbortSignal) => Promise<TRemote>;
  writeBack: (data: TRemote) => Promise<void>;
  // Lets a call site skip the background fetch entirely (e.g. deps not
  // ready yet) -- default true.
  enabled?: boolean;
}

// Stale-while-revalidate wrapper around useLiveQuery: the returned value is
// exactly useLiveQuery's own instant, reactive, cached value -- callers get
// zero added latency, identical to a plain useLiveQuery. The added behavior
// is a background side effect only: when online-or-unknown, race a direct
// Supabase fetch against NETWORK_FIRST_TIMEOUT_MS and, on success, write the
// result into Dexie via `writeBack` -- which flows straight back into the
// same useLiveQuery subscription above, no extra state needed at the call
// site. On failure/timeout, do nothing; the existing 30s poll / Realtime
// subscription / reconnect pull remain the backstop, exactly as before this
// hook existed.
export function useNetworkFirstQuery<T, TRemote>(
  queryFn: () => T | Promise<T>,
  deps: any[],
  { fetchRemote, writeBack, enabled = true }: NetworkFirstQueryOptions<TRemote>,
): T | undefined {
  const value = useLiveQuery(queryFn, deps);

  useEffect(() => {
    if (!enabled || !getIsOnlineSnapshot()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_FIRST_TIMEOUT_MS);
    fetchRemote(controller.signal)
      .then(writeBack)
      .catch(() => {
        // Silent by design -- cached data is already rendering.
      })
      .finally(() => clearTimeout(timer));
    return () => controller.abort();
    // deps is the caller's own dependency list (e.g. [category]) -- fetchRemote/
    // writeBack/enabled are expected to be stable or recreated alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
