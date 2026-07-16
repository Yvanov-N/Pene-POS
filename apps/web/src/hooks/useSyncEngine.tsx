import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNetworkStatus } from "./useNetworkStatus";
import { processSyncQueue, pullFromSupabase } from "@/services/syncService";

const SYNC_INTERVAL_MS = 50000;
const LAST_SYNCED_STORAGE_KEY = "pene-pos-last-synced-at";

interface SyncEngineValue {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  triggerManualSync: () => Promise<void>;
}

const SyncEngineContext = createContext<SyncEngineValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useNetworkStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() =>
    localStorage.getItem(LAST_SYNCED_STORAGE_KEY),
  );
  const syncingRef = useRef(false);
  // Starts false regardless of the actual initial isOnline value, so the
  // first time we're online -- whether that's immediately on mount or
  // later after reconnecting -- counts as a transition and fires a sync.
  const wasOnlineRef = useRef(false);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      await processSyncQueue();
      await pullFromSupabase();
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      localStorage.setItem(LAST_SYNCED_STORAGE_KEY, now);
    } catch (error) {
      console.error("[SyncProvider] sync cycle failed", error);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      void runSync();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline, runSync]);

  useEffect(() => {
    if (!isOnline) return;
    const interval = window.setInterval(() => void runSync(), SYNC_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isOnline, runSync]);

  const value: SyncEngineValue = {
    isOnline,
    isSyncing,
    lastSyncedAt,
    triggerManualSync: runSync,
  };

  return <SyncEngineContext.Provider value={value}>{children}</SyncEngineContext.Provider>;
}

export function useSyncEngine(): SyncEngineValue {
  const context = useContext(SyncEngineContext);
  if (!context) {
    throw new Error("useSyncEngine must be used within a SyncProvider");
  }
  return context;
}
