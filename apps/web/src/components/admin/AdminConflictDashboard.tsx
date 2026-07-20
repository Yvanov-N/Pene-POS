import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listConflicts,
  listOtherStuckItems,
  resolveByAdjustingStock,
  resolveByAcceptingNegativeStock,
  dismissConflict,
  retryStuckItem,
  type ConflictDetail,
  type StuckSyncItem,
} from "@/services/conflictResolver";

interface AdminConflictDashboardProps {
  onClose: () => void;
}

export function AdminConflictDashboard({ onClose }: AdminConflictDashboardProps) {
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<ConflictDetail[] | null>(null);
  const [otherStuck, setOtherStuck] = useState<StuckSyncItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setConflicts(await listConflicts());
    setOtherStuck(await listOtherStuckItems());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleResolveAll = () =>
    withBusy(async () => {
      const productIds = new Set<string>();
      for (const conflict of conflicts ?? []) {
        for (const line of conflict.lines) productIds.add(line.productId);
      }
      for (const productId of productIds) {
        await resolveByAdjustingStock(productId, 0);
      }
    });

  const isEmpty = (conflicts?.length ?? 0) === 0 && (otherStuck?.length ?? 0) === 0;
  const stillLoading = conflicts === null || otherStuck === null;

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
            ✕
          </button>
        </div>

        {stillLoading ? (
          <p className="text-sm text-muted">{t("admin.conflicts.loading")}</p>
        ) : isEmpty ? (
          <p className="text-sm text-muted">{t("admin.conflicts.empty")}</p>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {conflicts && conflicts.length > 0 && (
              <>
                {conflicts.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleResolveAll()}
                    className="mb-4 w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                  >
                    {t("admin.conflicts.resolveAll")}
                  </button>
                )}

                <ul className="mb-4 flex flex-col gap-3">
                  {conflicts.map((conflict) => {
                    const problemLines = conflict.lines.filter((line) => line.wouldBeStock < 0);
                    const linesToShow = problemLines.length > 0 ? problemLines : conflict.lines;

                    return (
                      <li key={conflict.sale.id} className="rounded-lg border border-destructive p-3">
                        <ul className="flex flex-col gap-3">
                          {linesToShow.map((line) => (
                            <li key={line.productId} className="flex flex-col gap-2">
                              <p className="text-sm text-foreground">
                                {t("admin.conflicts.lineDescription", {
                                  product: line.productName,
                                  stock: line.wouldBeStock,
                                })}
                              </p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void withBusy(() => resolveByAdjustingStock(line.productId, 0))
                                  }
                                  className="flex-1 rounded-lg border border-border bg-surface2 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                                >
                                  {t("admin.conflicts.adjustToZero")}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void withBusy(() =>
                                      resolveByAcceptingNegativeStock(line.productId, conflict.sale.id),
                                    )
                                  }
                                  className="flex-1 rounded-lg border border-border bg-surface2 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                                >
                                  {t("admin.conflicts.forceIgnore")}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {/* Anything that isn't a SALE stock conflict -- a stuck wallet
                recharge/withdrawal, a generic product/profile/shop_status
                update that hit a conflict or exhausted its retries. There's
                no product-aware resolution possible here (unlike the stock
                conflicts above), so the only actions are retry (assume it
                was a transient error) or dismiss (give up on this one
                mutation, stop it from blocking the sync badge). */}
            {otherStuck && otherStuck.length > 0 && (
              <div>
                <p className="stat-label mb-2">{t("admin.conflicts.otherStuckTitle")}</p>
                <ul className="flex flex-col gap-2">
                  {otherStuck.map((item) => (
                    <li key={item.id} className="rounded-lg border border-destructive p-3">
                      <p className="text-sm font-medium text-foreground">
                        {item.action} · {item.tableName}
                      </p>
                      <p className="text-xs text-muted">
                        {item.status === "conflict_warning"
                          ? t("admin.conflicts.otherStatusConflict")
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
                          disabled={busy}
                          onClick={() => void withBusy(() => retryStuckItem(item.id))}
                          className="flex-1 rounded-lg border border-border bg-surface2 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                        >
                          {t("admin.conflicts.retry")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void withBusy(() => dismissConflict(item.id))}
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
          </div>
        )}
      </div>
    </div>
  );
}
