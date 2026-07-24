import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { cancelPendingSalePush } from "@/services/sync/drain";
import { commitLocal, makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Sale } from "@/types/db";

export function MoMoVerificationCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingSales = useLiveQuery(
    () =>
      db.sales
        .toArray()
        .then((rows) =>
          rows
            .filter(
              (sale) =>
                (sale.payment_method === "momo_mtn" || sale.payment_method === "momo_orange") &&
                sale.momo_verification_status === "pending",
            )
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        ),
    [],
  );

  // Local-only lookup for a friendlier display than a raw cashier_id UUID --
  // profiles are already pulled down into Dexie by the sync engine.
  const cashierNames = useLiveQuery(
    () => db.profiles.toArray().then((profiles) => new Map(profiles.map((p) => [p.id, p.full_name]))),
    [],
  );

  const handleConfirm = async (sale: Sale) => {
    setBusyId(sale.id);
    try {
      const entry = makeOutboxEntry("generic_update", "sales", { id: sale.id, momo_verification_status: "confirmed" });
      await commitLocal(db.sales, () => db.sales.update(sale.id, { momo_verification_status: "confirmed" }), entry);
      void pushOutbox(entry);
      showToast("success", t("admin.momo.confirmedToast", { amount: formatCurrency(sale.total_amount) }));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (sale: Sale) => {
    setBusyId(sale.id);
    try {
      // Cancel any not-yet-pushed SALE outbox entry for this exact sale
      // first -- otherwise it could still reach Supabase and re-decrement
      // server-side stock after we've already restored it locally below.
      await cancelPendingSalePush(sale.id);

      const lines = await db.sale_items.where("sale_id").equals(sale.id).toArray();
      // One adjust_product_stock outbox entry per line, not a whole-row
      // products UPDATE -- the old code here read each product's stock into
      // a local snapshot and pushed the entire row back as a last-write-wins
      // update, the exact same stale-clobber shape refundService.voidSale
      // had (a confirmed root cause of reported stock mismatches). The
      // atomic server-side delta (adjust_product_stock, migration 00026)
      // can't lose a concurrent terminal's write the way a whole-row
      // overwrite can.
      const stockEntries = lines.map((line) =>
        makeOutboxEntry("adjust_product_stock", "products", {
          product_id: line.product_id,
          delta: line.quantity,
          reason: `momo_reject:${sale.id}`,
        }),
      );
      const statusEntry = makeOutboxEntry("generic_update", "sales", {
        id: sale.id,
        momo_verification_status: "rejected",
      });

      await db.transaction("rw", [db.products, db.sales, db.sync_outbox], async () => {
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          const product = await db.products.get(line.product_id);
          if (product) {
            await db.products.update(line.product_id, { stock: product.stock + line.quantity });
          }
          await recordOutbox(stockEntries[i]);
        }
        await db.sales.update(sale.id, { momo_verification_status: "rejected" });
        await recordOutbox(statusEntry);
      });

      void Promise.all([...stockEntries.map((e) => pushOutbox(e)), pushOutbox(statusEntry)]);

      showToast("error", t("admin.momo.rejectedToast"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <CardCustom className="mx-auto max-w-2xl" title={t("admin.momo.title")}>
        {pendingSales === undefined ? (
          <p className="text-sm text-muted">{t("admin.momo.loading")}</p>
        ) : pendingSales.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.momo.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingSales.map((sale) => (
              <li
                key={sale.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={sale.payment_method === "momo_mtn" ? "badge-amber" : "badge-orange"}>
                      {sale.payment_method === "momo_mtn" ? "MTN MoMo" : "Orange Money"}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {formatCurrency(sale.total_amount)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(sale.created_at).toLocaleTimeString()} ·{" "}
                    {cashierNames?.get(sale.cashier_id) ?? sale.cashier_id}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <ButtonCustom
                    variant="success"
                    size="sm"
                    disabled={busyId === sale.id}
                    onClick={() => void handleConfirm(sale)}
                  >
                    {t("admin.momo.confirm")}
                  </ButtonCustom>
                  <ButtonCustom
                    variant="danger"
                    size="sm"
                    disabled={busyId === sale.id}
                    onClick={() => void handleReject(sale)}
                  >
                    {t("admin.momo.reject")}
                  </ButtonCustom>
                </div>
              </li>
            ))}
          </ul>
        )}
    </CardCustom>
  );
}
