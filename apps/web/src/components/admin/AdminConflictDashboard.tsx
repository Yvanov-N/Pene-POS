import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listConflicts,
  resolveByAdjustingStock,
  resolveByAcceptingNegativeStock,
  type ConflictDetail,
} from "@/services/conflictResolver";

interface AdminConflictDashboardProps {
  onClose: () => void;
}

export function AdminConflictDashboard({ onClose }: AdminConflictDashboardProps) {
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<ConflictDetail[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setConflicts(await listConflicts());
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

        {conflicts === null ? (
          <p className="text-sm text-muted">{t("admin.conflicts.loading")}</p>
        ) : conflicts.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.conflicts.empty")}</p>
        ) : (
          <>
            {conflicts.length > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleResolveAll()}
                className="mb-4 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                {t("admin.conflicts.resolveAll")}
              </button>
            )}

            <div className="flex-1 overflow-y-auto">
              <ul className="flex flex-col gap-3">
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
