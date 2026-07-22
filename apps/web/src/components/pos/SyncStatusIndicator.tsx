import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { Wifi, WifiOff, AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { MAX_RETRIES } from "@/services/syncService";

type Tone = "online" | "offline" | "error" | "resyncing";

const TONE_ICON: Record<Tone, LucideIcon> = {
  online: Wifi,
  offline: WifiOff,
  error: AlertTriangle,
  resyncing: RefreshCw,
};

const TONE_COLOR: Record<Tone, string> = {
  online: "text-success",
  offline: "text-warning",
  error: "text-destructive",
  // Distinct from "online"'s green -- an in-progress resync is active work,
  // not "everything's fine", even though it's the good-outcome path.
  resyncing: "text-accent",
};

interface SyncStatusIndicatorProps {
  // Icon only, no text label -- used when the sidebar is collapsed. The
  // emoji itself still carries the state (unlike a plain colored dot would),
  // so connectivity/sync status stays visible even with zero spare width,
  // rather than disappearing behind the collapse toggle.
  compact?: boolean;
  // Only consulted while tone is "error" -- if the caller doesn't pass one
  // (e.g. the dashboard's OperationalWidgets mount, which has no conflicts
  // dashboard to open), clicking falls through to triggering a sync instead
  // of doing nothing.
  onErrorClick?: () => void;
}

export function SyncStatusIndicator({ compact = false, onErrorClick }: SyncStatusIndicatorProps) {
  const { t } = useTranslation();
  const { isOnline, isSyncing, triggerManualSync, checkNow } = useSyncEngine();

  const pendingCount =
    useLiveQuery(() => db.sync_queue.where("status").anyOf(["pending", "failed"]).count(), []) ?? 0;
  const conflictCount =
    useLiveQuery(() => db.sync_queue.where("status").equals("conflict_warning").count(), []) ?? 0;
  // "stuck" items: retried up to their budget and still failing -- distinct
  // from a normal "failed", which just means "will retry next cycle".
  const exhaustedCount =
    useLiveQuery(
      () =>
        db.sync_queue
          .where("status")
          .equals("failed")
          .and((item) => item.retryCount >= (item.maxRetries ?? MAX_RETRIES))
          .count(),
      [],
    ) ?? 0;

  // "error" outranks everything, regardless of connectivity or an in-flight
  // sync -- a conflict/exhausted item doesn't resolve itself just because a
  // sync cycle happens to be running, so it keeps its own look rather than
  // being masked by the resyncing spinner. Otherwise, a routine background
  // sync (30s poll, reconnect, or manual) gets its own "resyncing" tone
  // instead of overlaying a spinner on whatever tone happened to be showing.
  const baseTone: Tone = conflictCount > 0 || exhaustedCount > 0 ? "error" : !isOnline ? "offline" : "online";
  const tone: Tone = isSyncing && baseTone !== "error" ? "resyncing" : baseTone;

  const label =
    tone === "resyncing"
      ? t("sync.badgeSyncing")
      : tone === "error"
        ? t("sync.badgeError")
        : tone === "offline"
          ? pendingCount > 0
            ? t("sync.badgeOfflinePending", { count: pendingCount })
            : t("sync.badgeOffline")
          : t("sync.badgeOnline");

  const ToneIcon = TONE_ICON[tone];
  const content = (
    <>
      <ToneIcon
        className={`h-4 w-4 shrink-0 ${TONE_COLOR[tone]} ${tone === "resyncing" ? "animate-spin" : ""}`}
        aria-hidden
      />
      {!compact && <span className="truncate">{label}</span>}
    </>
  );

  // Priority: an error tone with a real handler opens the conflicts
  // dashboard (resyncing an already-classified conflict/exhausted item
  // doesn't fix it, only admin resolution does) -- otherwise, offline
  // confirms real reachability first (isOnline can be stale, and a manual
  // sync has no connectivity guard of its own), then just syncs.
  const handleClick = async () => {
    if (tone === "error" && onErrorClick) {
      onErrorClick();
      return;
    }
    if (tone === "offline") {
      const reachable = await checkNow();
      if (!reachable) return;
    }
    await triggerManualSync();
  };

  const title = tone === "error" ? `${label} — ${t("sync.badgeErrorHint")}` : `${label} — ${t("sync.tapToSync")}`;

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isSyncing}
      title={title}
      className={`inline-flex min-w-0 items-center gap-1.5 text-xs hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-70 ${
        tone === "error" ? "text-destructive" : "text-muted"
      }`}
    >
      {content}
    </button>
  );
}
