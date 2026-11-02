import { useCallback, useEffect, useRef, useState } from "react";
import { usePageVisible } from "./usePageVisible";

const PROBE_INTERVAL_MS = 30000;
const PING_TIMEOUT_MS = 4000;

const HEALTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// GoTrue's /health endpoint needs no *user* auth, but the hosted platform's
// Kong gateway still enforces an `apikey` header on every route including
// this one (confirmed live: a request with no headers gets a flat 401 "No
// API key found in request") -- the local CLI stack's Kong is more lenient
// and doesn't enforce this, which is why an earlier version of this file
// worked in local testing but left isOnline permanently stuck false against
// the real hosted project.
async function pingBackend(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, {
      method: "GET",
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

interface NetworkStatus {
  isOnline: boolean;
  checkNow: () => Promise<boolean>;
  // The sync cycle's own requests are the connectivity signal while online:
  // it reports whether they got through, so there's no separate ping then.
  reportReachable: (reachable: boolean) => void;
}

// Deliberately single-purpose: connectivity only. Sync orchestration
// (isSyncing/lastSyncedAt/triggerManualSync) lives in useSyncEngine, which
// composes this hook rather than folding those concerns in here.
//
// No fixed-interval ping any more: while online, every sync cycle already
// talks to Supabase (sync_watermarks) and reports the outcome through
// reportReachable. Only while offline -- network up but backend
// unreachable -- does this probe, every 30s and only while the page is
// visible, to notice the recovery.
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const visible = usePageVisible();
  // A shared in-flight promise, not a boolean guard -- concurrent callers
  // (the probe interval, an online event, a manual "Sync now") all await
  // the one real ping in flight instead of getting a stale shortcut answer.
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const checkNow = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const promise = pingBackend().then((reachable) => {
      setIsOnline(reachable);
      inFlightRef.current = null;
      return reachable;
    });
    inFlightRef.current = promise;
    return promise;
  }, []);

  const reportReachable = useCallback((reachable: boolean) => setIsOnline(reachable), []);

  useEffect(() => {
    // navigator.onLine going true just means "connected to a router" --
    // confirm with a real ping to avoid a Wi-Fi-but-no-internet false
    // positive. Going false is reliable enough to trust immediately.
    const handleOnline = () => void checkNow();
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void checkNow();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkNow]);

  // Recovery probe: only while offline, visible, and with a network to try.
  useEffect(() => {
    if (isOnline || !visible) return;
    const interval = window.setInterval(() => {
      if (navigator.onLine) void checkNow();
    }, PROBE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isOnline, visible, checkNow]);

  return { isOnline, checkNow, reportReachable };
}
