import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { SyncStatusIndicator } from "@/components/pos/SyncStatusIndicator";
import { AdminConflictDashboard } from "@/components/admin/AdminConflictDashboard";
import type { Product } from "@/types/db";

// Same thresholds as ProductGrid.tsx (POS grid badges) and the
// inventory-alerts edge function -- one low-stock/expiry definition used
// consistently across the whole app, not a dashboard-specific number.
const LOW_STOCK_THRESHOLD = 3;
const EXPIRY_WARNING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(expiryDate: string): number {
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / DAY_MS);
}

export function StockAlertWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // "stock" isn't indexed in the Dexie schema (id, barcode, category,
  // expiry_date, updated_at only) -- filter/sort in memory, same reasoning
  // as ProductsPage's table sort.
  const lowStockProducts = useLiveQuery(
    () =>
      db.products
        .toArray()
        .then((rows) => rows.filter((product) => product.stock <= LOW_STOCK_THRESHOLD).sort((a, b) => a.stock - b.stock)),
    [],
  );

  return (
    <CardCustom
      title={t("admin.dashboard.lowStockTitle")}
      header={
        <ButtonCustom variant="primary" size="sm" onClick={() => navigate("/admin/restocking")}>
          {t("admin.dashboard.goToRestocking")}
        </ButtonCustom>
      }
    >
      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
        {lowStockProducts === undefined ? (
          <p className="text-sm text-muted">{t("admin.dashboard.loading")}</p>
        ) : lowStockProducts.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.dashboard.lowStockEmpty")}</p>
        ) : (
          lowStockProducts.map((product: Product) => (
            <div
              key={product.id}
              className={`flex items-center justify-between rounded-lg border p-2 text-sm ${
                product.stock === 0 ? "border-destructive" : "border-warning"
              }`}
            >
              <span className="flex items-center gap-2 text-foreground">
                <span aria-hidden>{product.emoji || "📦"}</span>
                {product.name}
              </span>
              <span className={product.stock === 0 ? "badge-red" : "badge-amber"}>
                {t("pos.grid.stockLabel", { count: product.stock })}
              </span>
            </div>
          ))
        )}
      </div>
    </CardCustom>
  );
}

export function ExpiryWarningWidget() {
  const { t } = useTranslation();

  const expiringProducts = useLiveQuery(async () => {
    const horizonIso = new Date(Date.now() + EXPIRY_WARNING_DAYS * DAY_MS).toISOString();
    const rows = await db.products.where("expiry_date").belowOrEqual(horizonIso).sortBy("expiry_date");
    return rows;
  }, []);

  return (
    <CardCustom title={t("admin.dashboard.expiryTitle")}>
      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
        {expiringProducts === undefined ? (
          <p className="text-sm text-muted">{t("admin.dashboard.loading")}</p>
        ) : expiringProducts.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.dashboard.expiryEmpty")}</p>
        ) : (
          expiringProducts.map((product) => {
            const remaining = daysUntil(product.expiry_date!);
            const expired = remaining < 0;
            return (
              <div
                key={product.id}
                className={`flex items-center justify-between rounded-lg border p-2 text-sm ${
                  expired ? "border-destructive" : "border-warning"
                }`}
              >
                <span className="flex items-center gap-2 text-foreground">
                  <span aria-hidden>{product.emoji || "📦"}</span>
                  {product.name}
                </span>
                <span className={expired ? "badge-red" : "badge-amber"}>
                  {expired ? t("pos.grid.expired") : t("admin.dashboard.expiresInDays", { count: remaining })}
                </span>
              </div>
            );
          })
        )}
      </div>
    </CardCustom>
  );
}

export function SyncConflictStatusBar() {
  const { t } = useTranslation();
  const { isOnline } = useSyncEngine();
  const [conflictsOpen, setConflictsOpen] = useState(false);

  const pendingCount = useLiveQuery(
    () => db.sync_queue.where("status").anyOf(["pending", "failed"]).count(),
    [],
  );
  const conflictCount = useLiveQuery(() => db.sales.where("status").equals("conflict_warning").count(), []);

  return (
    <CardCustom title={t("admin.dashboard.syncStatusTitle")}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t("admin.dashboard.networkStatus")}</span>
          <SyncStatusIndicator />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t("admin.dashboard.pendingSyncItems")}</span>
          <span className="font-medium text-foreground">{pendingCount ?? 0}</span>
        </div>

        {!!conflictCount && conflictCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive p-3">
            <p className="text-sm text-destructive">
              {t("admin.dashboard.conflictBanner", { count: conflictCount })}
            </p>
            <ButtonCustom variant="danger" size="sm" onClick={() => setConflictsOpen(true)}>
              {t("admin.dashboard.viewConflicts")}
            </ButtonCustom>
          </div>
        )}

        {!isOnline && (
          <p className="text-xs text-muted">{t("admin.dashboard.offlineHint")}</p>
        )}
      </div>

      {conflictsOpen && <AdminConflictDashboard onClose={() => setConflictsOpen(false)} />}
    </CardCustom>
  );
}
