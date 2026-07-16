import { useCallback, useEffect, useRef, useState } from "react";

const PING_INTERVAL_MS = 20000;
const PING_TIMEOUT_MS = 4000;

const HEALTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`;

// GoTrue's /health endpoint answers with no auth header required -- a
// lightweight, unauthenticated ping target confirmed working against the
// local stack during earlier phases.
async function pingBackend(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, {
      method: "GET",
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
  const checkingRef = useRef(false);

  const checkNow = useCallback(async () => {
    if (checkingRef.current) return isOnline;
    checkingRef.current = true;
    const reachable = await pingBackend();
    checkingRef.current = false;
    setIsOnline(reachable);
    return reachable;
  }, [isOnline]);

  useEffect(() => {
    // navigator.onLine going true just means "connected to a router" --
    // confirm with a real ping to avoid a Wi-Fi-but-no-internet false
    // positive. Going false is reliable enough to trust immediately.
    const handleOnline = () => void checkNow();
    const handleOffline = () => setIsOnline(false);

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
