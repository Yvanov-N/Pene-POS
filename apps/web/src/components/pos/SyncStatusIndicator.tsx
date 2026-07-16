import { useTranslation } from "react-i18next";
import { useSyncEngine } from "@/hooks/useSyncEngine";

export function SyncStatusIndicator() {
  const { t } = useTranslation();
  const { isOnline, isSyncing, lastSyncedAt } = useSyncEngine();

  const label = !isOnline ? t("sync.offline") : isSyncing ? t("sync.syncing") : t("sync.online");
  const dotClass = !isOnline ? "bg-muted" : isSyncing ? "bg-warning animate-pulse" : "bg-success";
  const tooltip = lastSyncedAt
    ? `${label} — ${new Date(lastSyncedAt).toLocaleTimeString()}`
    : label;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={tooltip}>
      <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
      {label}
    </span>
  );
}
