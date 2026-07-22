import { useCallback, useEffect, useRef, useState } from "react";
import { setIsOnlineSnapshot } from "@/lib/networkStatusStore";

const PING_INTERVAL_MS = 20000;
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
}

// Deliberately single-purpose: connectivity only. Sync orchestration
// (isSyncing/lastSyncedAt/triggerManualSync) lives in useSyncEngine, which
// composes this hook rather than folding those concerns in here.
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // A shared in-flight promise, not a boolean guard -- a boolean guard would
  // make a concurrent caller bail out with whatever `isOnline` happened to
  // read as before the real ping resolved (stale, possibly wrong: e.g. still
  // `true` from before a connection just dropped). With ~15+ call sites now
  // able to trigger a check around the same moment (the 20s interval, an
  // online/offline browser event, and every runSync() call in
  // useSyncEngine.tsx), concurrent calls are common, not an edge case -- so
  // every caller awaits the one real ping already in flight instead of
  // getting a shortcut answer.
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const checkNow = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const promise = pingBackend().then((reachable) => {
      setIsOnline(reachable);
      setIsOnlineSnapshot(reachable);
      inFlightRef.current = null;
      return reachable;
    });
    inFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    // navigator.onLine going true just means "connected to a router" --
    // confirm with a real ping to avoid a Wi-Fi-but-no-internet false
    // positive. Going false is reliable enough to trust immediately.
    const handleOnline = () => void checkNow();
    const handleOffline = () => {
      setIsOnline(false);
      setIsOnlineSnapshot(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void checkNow();
    const interval = window.setInterval(() => void checkNow(), PING_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOnline, checkNow };
}
