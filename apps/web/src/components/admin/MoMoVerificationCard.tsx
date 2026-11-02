import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { usePendingMomoSales } from "@/hooks/usePendingMomoSales";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { MomoVerifyActions } from "./MomoVerifyActions";

export function MoMoVerificationCard() {
  const { t } = useTranslation();
  const pendingSales = usePendingMomoSales();

  // Local-only lookup for a friendlier display than a raw cashier_id UUID --
  // profiles are already pulled down into Dexie by the sync engine.
  const cashierNames = useLiveQuery(
    () => db.profiles.toArray().then((profiles) => new Map(profiles.map((p) => [p.id, p.full_name]))),
    [],
  );

  return (
    <CardCustom title={t("admin.momo.title")}>
        {pendingSales === undefined ? (
          <p className="text-sm text-muted">{t("admin.momo.loading")}</p>
        ) : pendingSales.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.momo.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingSales.map((sale) => (
              // Stacked, not side by side: this card is only 4/12 wide next to
              // the students table, too narrow for details + two buttons on one
              // line (they used to overlap). Same layout at every width.
              <li key={sale.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className={`${sale.payment_method === "momo_mtn" ? "badge-amber" : "badge-orange"} whitespace-nowrap`}>
                      {sale.payment_method === "momo_mtn" ? "MTN MoMo" : "Orange Money"}
                    </span>
                    <p className="mt-1 truncate text-xs text-muted">
                      {new Date(sale.created_at).toLocaleTimeString()} ·{" "}
                      {sale.device_label ?? cashierNames?.get(sale.cashier_id) ?? sale.cashier_id}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-base font-semibold text-foreground">
                    {formatCurrency(sale.total_amount)}
                  </span>
                </div>
                <MomoVerifyActions sale={sale} />
              </li>
            ))}
          </ul>
        )}
    </CardCustom>
  );
}
