import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/lib/currency";
import { paginate } from "@/lib/pagination";
import { usePageSize } from "@/hooks/usePageSize";
import { PaginationControls } from "@/components/admin/PaginationControls";
import type { ProductProfit } from "@/hooks/useDashboardAnalytics";

interface ProfitabilityTableProps {
  data: ProductProfit[];
}

// Revenue vs purchase cost per product over the selected range -- what each
// product actually earned, not just what it sold.
export function ProfitabilityTable({ data }: ProfitabilityTableProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("profitability");

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{t("admin.dashboard.noData")}</p>;
  }

  // Clamped: a narrower date range can leave fewer pages than before.
  const { rows, totalPages } = paginate(data, page, pageSize);
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
      <PaginationControls
        page={Math.min(page, totalPages)}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
