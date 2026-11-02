import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/lib/currency";
import type { ProductProfit } from "@/hooks/useDashboardAnalytics";

const INITIAL_ROWS = 10;

interface ProfitabilityTableProps {
  data: ProductProfit[];
}

// Revenue vs purchase cost per product over the selected range -- what each
// product actually earned, not just what it sold.
export function ProfitabilityTable({ data }: ProfitabilityTableProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{t("admin.dashboard.noData")}</p>;
  }

  const rows = showAll ? data : data.slice(0, INITIAL_ROWS);
  const maxRevenue = Math.max(...data.map((row) => row.revenue), 1);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3">{t("admin.dashboard.profit.columnProduct")}</th>
              <th className="py-2 pr-3 text-right">{t("admin.dashboard.profit.columnQuantity")}</th>
              <th className="py-2 pr-3 text-right">{t("admin.dashboard.profit.columnRevenue")}</th>
              <th className="py-2 pr-3 text-right">{t("admin.dashboard.profit.columnCost")}</th>
              <th className="py-2 pr-3 text-right">{t("admin.dashboard.profit.columnProfit")}</th>
              <th className="py-2 text-right">{t("admin.dashboard.profit.columnMargin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const costedShare = row.revenue > 0 ? Math.min(1, row.cost / row.revenue) : 0;
              return (
                <tr key={row.productId} className="border-b border-border">
                  <td className="py-2 pr-3">
                    <p className="text-foreground">{row.name}</p>
                    {/* Revenue bar, the cost part shaded -- the rest is profit. */}
                    <div
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-success/30"
                      style={{ width: `${Math.max(8, (row.revenue / maxRevenue) * 100)}%` }}
                      aria-hidden
                    >
                      <div className="h-full bg-destructive/60" style={{ width: `${costedShare * 100}%` }} />
                    </div>
                    {row.uncostedQuantity > 0 && (
                      <p className="mt-0.5 text-xs text-muted">
                        {t("admin.dashboard.profit.uncostedUnits", { count: row.uncostedQuantity })}
                      </p>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right text-foreground">{row.quantitySold}</td>
                  <td className="py-2 pr-3 text-right text-foreground">{formatCurrency(row.revenue)}</td>
                  <td className="py-2 pr-3 text-right text-muted">{row.marginPct === null ? "—" : formatCurrency(row.cost)}</td>
                  <td
                    className={`py-2 pr-3 text-right font-semibold ${
                      row.marginPct === null ? "text-muted" : row.profit < 0 ? "text-destructive" : "text-success"
                    }`}
                  >
                    {row.marginPct === null ? "—" : formatCurrency(row.profit)}
                  </td>
                  <td className="py-2 text-right text-foreground">{row.marginPct === null ? "—" : `${row.marginPct}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.length > INITIAL_ROWS && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
          >
            {showAll ? t("admin.dashboard.profit.showLess") : t("admin.dashboard.profit.showAll", { count: data.length })}
          </button>
        </div>
      )}
    </div>
  );
}
