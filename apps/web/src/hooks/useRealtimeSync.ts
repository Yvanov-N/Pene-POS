import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pullAll } from "@/services/sync/pull";

const DEBOUNCE_MS = 1000;
const REALTIME_TABLES = ["products", "sales", "student_wallets"] as const;

// Latency optimisation on top of useSyncEngine's periodic cycle: a Postgres
// change on another till triggers a pull within ~1s instead of waiting for
// the next poll. pullAll only refetches the tables whose watermark moved
// (migration 00039), so a notification costs 1-2 requests, not 11; a burst
// of notifications (a checkout touches sales, sale_items, products and
// maybe a wallet) collapses into one pull via the debounce and pullAll's
// own single-flight.
//
// Returns whether the socket is subscribed: while it is, the periodic poll
// is only a slow safety net (useSyncEngine). Only the sync-leader tab
// subscribes, and notifications that land while the page is hidden are
// left for the catch-up sync that runs when it becomes visible again.
export function useRealtimeSync(enabled: boolean): boolean {
  const debounceRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const schedulePull = () => {
      if (document.visibilityState !== "visible") return;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => void pullAll(), DEBOUNCE_MS);
    };

    let channel = supabase.channel("realtime-sync");
    for (const table of REALTIME_TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, schedulePull);
    }
    // If the socket never connects (unsupported, blocked, offline) or drops,
    // `connected` goes false and useSyncEngine falls back to fast polling.
    channel.subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return connected;
}
