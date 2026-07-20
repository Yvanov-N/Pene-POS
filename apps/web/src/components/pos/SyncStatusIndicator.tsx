import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { MAX_RETRIES } from "@/services/syncService";

type Tone = "online" | "offline" | "error";

const TONE_ICON: Record<Tone, string> = {
  online: "🟢",
  offline: "🟡",
  error: "🔴",
};

interface SyncStatusIndicatorProps {
  // Icon only, no text label -- used when the sidebar is collapsed. The
  // emoji itself still carries the state (unlike a plain colored dot would),
  // so connectivity/sync status stays visible even with zero spare width,
  // rather than disappearing behind the collapse toggle.
  compact?: boolean;
  // Only invoked while tone is "error" -- there's nothing to open otherwise.
  // The badge itself has no idea how to open AdminConflictDashboard (that's
  // PIN-gated state living in SidebarNav), so this just reports "the error
  // badge was clicked" upward rather than owning that flow itself.
  onErrorClick?: () => void;
}

export function SyncStatusIndicator({ compact = false, onErrorClick }: SyncStatusIndicatorProps) {
  const { t } = useTranslation();
  const { isOnline } = useSyncEngine();

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

  // Only three states are ever shown: plain online/offline covers the
  // overwhelming majority of the time (including while a routine background
  // sync is quietly running -- that's not something worth a distinct badge
  // state; it happens every 30s and resolves in well under a second), and
  // "error" -- which outranks both, regardless of connectivity, since a
  // conflict doesn't resolve itself just because the network came back --
  // only appears when something genuinely needs admin attention.
  const tone: Tone = conflictCount > 0 || exhaustedCount > 0 ? "error" : !isOnline ? "offline" : "online";

  const label =
    tone === "error"
      ? t("sync.badgeError")
      : tone === "offline"
        ? pendingCount > 0
          ? t("sync.badgeOfflinePending", { count: pendingCount })
          : t("sync.badgeOffline")
        : t("sync.badgeOnline");

  const content = (
    <>
      <span aria-hidden>{TONE_ICON[tone]}</span>
      {!compact && <span className="truncate">{label}</span>}
    </>
  );

  if (tone === "error" && onErrorClick) {
    return (
      <button
        type="button"
        onClick={onErrorClick}
        title={`${label} — ${t("sync.badgeErrorHint")}`}
        className="inline-flex min-w-0 items-center gap-1.5 text-xs text-destructive hover:underline"
      >
        {content}
      </button>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted" title={label}>
      {content}
    </span>
  );
}
