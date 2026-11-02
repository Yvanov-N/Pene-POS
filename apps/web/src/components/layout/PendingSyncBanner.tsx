import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudOff, RefreshCw, Bell } from "lucide-react";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { usePendingSync } from "@/hooks/usePendingSync";
import { requestNotificationPermission } from "@/services/pushService";

// Thin bar above every page while operations wait to be sent for a while (or
// the device is offline): on a phone, closing or locking the app at that
// point means nobody else sees those sales until it's reopened (Android may
// still send them in the background; iPhone won't).
export function PendingSyncBanner() {
  const { t } = useTranslation();
  const { isOnline, isSyncing, triggerManualSync } = useSyncEngine();
  const { count, sales, stuck } = usePendingSync(isOnline);
  // The reminder notification (with its "Send" button) needs permission --
  // offer it right here, the moment it's useful, rather than buried in Settings.
  const [permission, setPermission] = useState(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  if (!stuck) return null;

  const what = sales > 0 ? t("sync.pendingSales", { count: sales }) : t("sync.pendingOperations", { count });

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-xs text-foreground"
    >
      <CloudOff className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{what}</span> {isOnline ? t("sync.pendingHintOnline") : t("sync.pendingHintOffline")}
      </p>
      {permission === "default" && (
        <button
          type="button"
          onClick={() => void requestNotificationPermission().then(setPermission)}
          className="shrink-0 rounded-lg border border-border bg-surface px-2 py-1 font-medium hover:border-accent"
        >
          <Bell className="h-4 w-4 shrink-0" aria-hidden />
          {t("sync.notifyMe")}
        </button>
      )}
      {isOnline && (
        <button
          type="button"
          onClick={() => void triggerManualSync()}
          disabled={isSyncing}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 font-medium hover:border-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} aria-hidden />
          {t("sync.retryNow")}
        </button>
      )}
    </div>
  );
}
