import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNetworkStatus } from "./useNetworkStatus";
import { useToast } from "./useToast";
import { useRealtimeSync } from "./useRealtimeSync";
import { usePageVisible } from "./usePageVisible";
import { useSyncLeader } from "./useSyncLeader";
import { db } from "@/lib/db";
import { drainOutbox } from "@/services/sync/drain";
import { fetchWatermarks, pullAll } from "@/services/sync/pull";

// Periodic safety-net cycle. Fast while Realtime is down (it's then the only
// way to see other tills' changes), slow while Realtime is subscribed (it
// already triggers a pull within ~1s of any change). Either way a quiet
// cycle is one request (sync_watermarks), and none at all while the page
// is hidden or in a non-leader tab.
const SYNC_INTERVAL_MS = 30000;
const SYNC_INTERVAL_REALTIME_MS = 180000;
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
  // Re-exposed from useNetworkStatus so a manual "Sync Now" button can
  // confirm real connectivity before calling triggerManualSync -- isOnline
  // alone can be stale between sync cycles (it's updated from each cycle's
  // own requests and online/offline browser events, with no periodic ping).
  checkNow: () => Promise<boolean>;
}

const SyncEngineContext = createContext<SyncEngineValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isOnline, checkNow, reportReachable } = useNetworkStatus();
  const isLeader = useSyncLeader();
  const visible = usePageVisible();
  const realtimeConnected = useRealtimeSync(isLeader && isOnline);
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
    // Certain-offline (no network interface): don't even try.
    if (!navigator.onLine) {
      reportReachable(false);
      return;
    }
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      // triggerManualSync (this function) is called from many unrelated
      // call sites that don't check connectivity -- the watermark fetch is
      // this cycle's single reachability check (it replaced the separate
      // health-check ping), so every caller is safe by construction.
      const probe = await fetchWatermarks();
      if (!probe.ok && probe.reason === "unreachable") {
        reportReachable(false);
        return;
      }
      reportReachable(true);

      // Anything about to be pushed changes the server, which makes the
      // probe's watermarks stale -- only reuse them for a cycle with
      // nothing to push (the common case).
      const pendingPushes = await db.sync_outbox.where("status").anyOf(["pending", "error"]).count();
      const { syncedSales, conflicts } = await drainOutbox();
      await pullAll(pendingPushes === 0 && probe.ok ? probe.watermarks : undefined);

      // Only toast when something actually happened this cycle -- the
      // interval fires every 30s (SYNC_INTERVAL_MS) regardless of whether
      // the outbox had anything pending in it, and a still-unresolved
      // conflict is never re-counted (drainOutbox only selects pending/
      // error items, and a conflict transitions straight to "conflict"
      // status, so it can't show up here again on a later cycle and
      // re-toast forever).
      if (syncedSales > 0) {
        showToast("success", t("sync.toastSuccess", { count: syncedSales }));
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
  }, [t, showToast, reportReachable]);

  // Coming (back) online: catch up immediately.
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current && isLeader) {
      void runSync();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline, isLeader, runSync]);

  // Back to the foreground (or just became the leader tab): catch up on
  // whatever happened while polling was paused.
  useEffect(() => {
    if (visible && isLeader && isOnline) void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isLeader]);

  useEffect(() => {
    if (!isOnline || !isLeader || !visible) return;
    const every = realtimeConnected ? SYNC_INTERVAL_REALTIME_MS : SYNC_INTERVAL_MS;
    const interval = window.setInterval(() => void runSync(), every);
    return () => window.clearInterval(interval);
  }, [isOnline, isLeader, visible, realtimeConnected, runSync]);

  const value = useMemo<SyncEngineValue>(
    () => ({ isOnline, isSyncing, lastSyncedAt, triggerManualSync: runSync, checkNow }),
    [isOnline, isSyncing, lastSyncedAt, runSync, checkNow],
  );

  return <SyncEngineContext.Provider value={value}>{children}</SyncEngineContext.Provider>;
}

export function useSyncEngine(): SyncEngineValue {
  const context = useContext(SyncEngineContext);
  if (!context) {
    throw new Error("useSyncEngine must be used within a SyncProvider");
  }
  return context;
}
