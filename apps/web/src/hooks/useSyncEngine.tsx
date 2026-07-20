import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNetworkStatus } from "./useNetworkStatus";
import { useToast } from "./useToast";
import { processSyncQueue, pullFromSupabase } from "@/services/syncService";

const SYNC_INTERVAL_MS = 30000;
const LAST_SYNCED_STORAGE_KEY = "pene-pos-last-synced-at";
// A stock conflict needs a cashier/admin to actually notice and act on it
// (go resolve it in the conflicts dashboard) -- longer than the default 3s
// toast, but still auto-dismissing rather than a permanent fixture, to stay
// consistent with this engine's "non-intrusive, no blocking popups" goal.
const CONFLICT_TOAST_DURATION_MS = 8000;

interface SyncEngineValue {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  triggerManualSync: () => Promise<void>;
}

const SyncEngineContext = createContext<SyncEngineValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useNetworkStatus();
  const { t } = useTranslation();
  const { showToast } = useToast();
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
      const { completedSales, conflicts } = await processSyncQueue();
      await pullFromSupabase();

      // Only toast when something actually happened this cycle -- the
      // interval fires every 50s regardless of whether the queue had
      // anything in it, and a still-unresolved conflict is never re-counted
      // (processSyncQueue only selects pending/failed items, and a conflict
      // transitions straight to conflict_warning, so it can't show up here
      // again on a later cycle and re-toast forever).
      if (completedSales > 0) {
        showToast("success", t("sync.toastSuccess", { count: completedSales }));
      }
      if (conflicts > 0) {
        showToast("error", t("sync.toastConflict"), CONFLICT_TOAST_DURATION_MS);
      }

      const now = new Date().toISOString();
      setLastSyncedAt(now);
      localStorage.setItem(LAST_SYNCED_STORAGE_KEY, now);
    } catch (error) {
      console.error("[SyncProvider] sync cycle failed", error);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [t, showToast]);

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
