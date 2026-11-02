import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pullAll } from "@/services/sync/pull";
import { applyRealtimeChange, REALTIME_TABLES, type RealtimeChange } from "@/services/sync/realtimeApply";

const FALLBACK_PULL_DEBOUNCE_MS = 1000;

// Realtime is the primary way changes from other tills arrive: each change
// payload carries the full row and is written straight into Dexie
// (applyRealtimeChange) -- zero requests per sale, restock or toggle. A pull
// only happens when:
//   * a payload can't be applied as-is (fallback, debounced), and
//   * the channel (re)subscribes -- messages sent while the socket was down
//     are not replayed, so one watermark check (usually a single request)
//     catches up on whatever was missed.
// useSyncEngine's periodic cycle stays as a slow safety net while this is
// subscribed, and becomes fast polling again when it isn't (`connected`).
// Only the sync-leader tab subscribes; other tabs see the writes through
// Dexie's cross-tab live queries.
export function useRealtimeSync(enabled: boolean): boolean {
  const debounceRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const schedulePull = () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => void pullAll(), FALLBACK_PULL_DEBOUNCE_MS);
    };

    const handleChange = (payload: RealtimeChange) => {
      applyRealtimeChange(payload)
        .then((applied) => {
          // shop_status also carries the data epoch: a pull checks it and
          // rebuilds the local copy after a "replace all" import.
          if (!applied || payload.table === "shop_status") schedulePull();
        })
        .catch((error) => {
          console.warn("[realtime] could not apply change, pulling instead", error);
          schedulePull();
        });
    };

    let channel = supabase.channel("realtime-sync");
    for (const table of REALTIME_TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) =>
        handleChange(payload as unknown as RealtimeChange),
      );
    }
    channel.subscribe((status) => {
      const subscribed = status === "SUBSCRIBED";
      setConnected(subscribed);
      // Covers both the gap between the initial sync and this subscription
      // and any outage before a reconnect.
      if (subscribed) void pullAll();
    });

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return connected;
}
