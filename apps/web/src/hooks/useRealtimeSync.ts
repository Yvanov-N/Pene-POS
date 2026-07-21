import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { pullFromSupabase } from "@/services/syncService";

const DEBOUNCE_MS = 500;
const REALTIME_TABLES = ["products", "sales", "student_wallets"] as const;

// Additive latency optimization on top of useSyncEngine's existing 30s poll
// + reconnect-driven checkNow() -- those remain the correctness backbone.
// This just shortens the "another till already sold/restocked this" window
// from up to 30s down to ~1s by reusing the same, already-tested pull path
// the moment Postgres reports a change, instead of waiting for the interval.
// If the socket never connects (unsupported browser, blocked, offline),
// sync degrades exactly to the pre-Realtime behavior -- no separate
// online/offline handling needed here.
export function useRealtimeSync(): void {
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const schedulePull = () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => void pullFromSupabase(), DEBOUNCE_MS);
    };

    let channel = supabase.channel("realtime-sync");
    for (const table of REALTIME_TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, schedulePull);
    }
    channel.subscribe();

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, []);
}
