import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  listStuckItems,
  listRecentSyncEvents,
  retryStuckItem,
  dismissStuckItem,
  type StuckOutboxItem,
  type RecentSyncEvent,
} from "@/services/sync/conflicts";

interface AdminConflictDashboardProps {
  onClose: () => void;
}

// Much smaller than the old AdminConflictDashboard: that version's headline
// feature (a per-product "adjust stock to X" resolution UI, plus the
// "resolve all" action that once hard-zeroed real stock -- fixed, then
// finally made moot) existed to resolve a stock-oversell conflict. Migration
// 00019 already removed the constraint that used to raise one, and this
// rebuild confirmed via a live smoke test that a concurrent oversell now
// always completes with a tracked `negative_stock` flag, never a conflict.
// What's left is a uniform "stuck items" list (any op type, retry or
// dismiss) plus a read-only feed of recent negative-stock/negative-balance
// events for situational awareness -- see services/sync/conflicts.ts.
export function AdminConflictDashboard({ onClose }: AdminConflictDashboardProps) {
  const { t } = useTranslation();
  const [stuck, setStuck] = useState<StuckOutboxItem[] | null>(null);
  const [events, setEvents] = useState<RecentSyncEvent[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = async () => {
    setStuck(await listStuckItems());
    setEvents(await listRecentSyncEvents());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const withBusy = async (id: number, action: () => Promise<void>) => {
    setBusyId(id);
    try {
      await action();
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const stillLoading = stuck === null || events === null;
  const isEmpty = (stuck?.length ?? 0) === 0 && (events?.length ?? 0) === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t("admin.conflicts.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {stillLoading ? (
          <p className="text-sm text-muted">{t("admin.conflicts.loading")}</p>
        ) : isEmpty ? (
          <p className="text-sm text-muted">{t("admin.conflicts.empty")}</p>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {stuck && stuck.length > 0 && (
              <div className="mb-4">
                <p className="stat-label mb-2">{t("admin.conflicts.otherStuckTitle")}</p>
                <ul className="flex flex-col gap-2">
                  {stuck.map((item) => (
                    <li key={item.id} className="rounded-lg border border-destructive p-3">
                      <p className="text-sm font-medium text-foreground">
                        {item.opType} · {item.tableName}
                      </p>
                      <p className="text-xs text-muted">
                        {item.status === "conflict"
                          ? (item.conflictReason ?? t("admin.conflicts.otherStatusConflict"))
                          : t("admin.conflicts.otherStatusExhausted", { count: item.retryCount })}
                      </p>
                      {item.errorMessage && (
                        <p className="mt-1 truncate text-xs text-destructive" title={item.errorMessage}>
                          {item.errorMessage}
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void withBusy(item.id, () => retryStuckItem(item.id))}
                          className="flex-1 rounded-lg border border-border bg-surface2 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                        >
                          {t("admin.conflicts.retry")}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void withBusy(item.id, () => dismissStuckItem(item.id))}
                          className="flex-1 rounded-lg border border-border bg-surface2 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                        >
                          {t("admin.conflicts.dismiss")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {events && events.length > 0 && (
              <div>
                <p className="stat-label mb-2">{t("admin.conflicts.recentEventsTitle")}</p>
                <ul className="flex flex-col gap-2">
                  {events.map((event, index) => (
                    <li key={index} className="rounded-lg border border-border p-3">
                      <p className="text-sm text-foreground">{event.message ?? event.eventType}</p>
                      <p className="text-xs text-muted">
                        {event.entityTable ?? "—"} · {new Date(event.occurredAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
