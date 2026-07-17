import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { cancelPendingSalePush, enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Sale } from "@/types/db";

interface MoMoVerificationCardProps {
  onClose: () => void;
}

export function MoMoVerificationCard({ onClose }: MoMoVerificationCardProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();
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
      await db.sales.update(sale.id, { momo_verification_status: "confirmed" });
      await enqueueMutation("UPDATE", "sales", { id: sale.id, momo_verification_status: "confirmed" });
      void triggerManualSync();
      showToast("success", t("admin.momo.confirmedToast", { amount: formatCurrency(sale.total_amount) }));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (sale: Sale) => {
    setBusyId(sale.id);
    try {
      // Cancel any not-yet-pushed SALE queue entry for this exact sale
      // first -- otherwise it could still reach Supabase and re-decrement
      // server-side stock after we've already restored it locally below.
      await cancelPendingSalePush(sale.id);

      const lines = await db.sale_items.where("sale_id").equals(sale.id).toArray();
      for (const line of lines) {
        const product = await db.products.get(line.product_id);
        if (product) {
          const updated = { ...product, stock: product.stock + line.quantity };
          await db.products.put(updated);
          await enqueueMutation("UPDATE", "products", { ...updated });
        }
      }

      await db.sales.update(sale.id, { momo_verification_status: "rejected" });
      await enqueueMutation("UPDATE", "sales", { id: sale.id, momo_verification_status: "rejected" });
      void triggerManualSync();

      showToast("error", t("admin.momo.rejectedToast"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <CardCustom
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto"
        title={t("admin.momo.title")}
        header={
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            ✕
          </button>
        }
      >
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
    </div>
  );
}
