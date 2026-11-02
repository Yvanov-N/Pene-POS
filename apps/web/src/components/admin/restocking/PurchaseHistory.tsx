import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { downloadCsv } from "@/lib/csv";
import { priceChangeByPurchase, summarizePurchases } from "@/lib/purchaseStats";
import { paginate } from "@/lib/pagination";
import { usePageSize } from "@/hooks/usePageSize";
import { PaginationControls } from "@/components/admin/PaginationControls";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { INPUT_CLASS } from "./styles";

const ALL = "all";

// Every restock (stock_purchases), newest first, with the unit cost change vs
// the previous purchase of the same product -- the price-evolution log.
export function PurchaseHistory() {
  const { t } = useTranslation();
  const [productFilter, setProductFilter] = useState(ALL);
  const [supplierFilter, setSupplierFilter] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("purchases");
  // Any filter change could otherwise leave us on a page that no longer exists.
  const withPageReset = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const data = useLiveQuery(async () => {
    const [purchases, products, suppliers] = await Promise.all([
      db.stock_purchases.orderBy("created_at").reverse().toArray(),
      db.products.toArray(),
      db.suppliers.orderBy("name").toArray(),
    ]);
    return { purchases, products: products.sort((a, b) => a.name.localeCompare(b.name)), suppliers };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const productNames = new Map(data.products.map((p) => [p.id, p.name]));
    const supplierNames = new Map(data.suppliers.map((s) => [s.id, s.name]));
    // Changes are computed over the full history, so a filter never turns a
    // product's second purchase into its "first".
    const changes = priceChangeByPurchase(data.purchases);
    const start = from ? new Date(`${from}T00:00:00`).toISOString() : null;
    const end = to ? new Date(`${to}T23:59:59.999`).toISOString() : null;
    const rows = data.purchases.filter(
      (p) =>
        (productFilter === ALL || p.product_id === productFilter) &&
        (supplierFilter === ALL || p.supplier_id === supplierFilter) &&
        (!start || p.created_at >= start) &&
        (!end || p.created_at <= end),
    );
    return { rows, changes, productNames, supplierNames, summary: summarizePurchases(rows) };
  }, [data, productFilter, supplierFilter, from, to]);

  const pageView = view ? paginate(view.rows, page, pageSize) : null;

  const productName = (id: string) => view?.productNames.get(id) ?? t("restocking.history.deletedProduct");
  const supplierName = (id: string) => view?.supplierNames.get(id) ?? t("restocking.history.deletedSupplier");

  const handleExport = () => {
    if (!view) return;
    downloadCsv(`ravitaillements-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        t("restocking.history.columnDate"),
        t("restocking.history.columnProduct"),
        t("restocking.history.columnSupplier"),
        t("restocking.history.columnQuantity"),
        t("restocking.history.columnUnitCost"),
        t("restocking.history.columnTotal"),
        t("restocking.history.columnChange"),
      ],
      ...view.rows.map((p) => {
        const change = view.changes.get(p.id);
        return [
          new Date(p.created_at).toLocaleString(),
          productName(p.product_id),
          supplierName(p.supplier_id),
          p.quantity,
          p.unit_cost,
          p.quantity * p.unit_cost,
          change !== undefined ? `${change.toFixed(1)}%` : "",
        ];
      }),
    ]);
  };

  return (
    <CardCustom
      title={t("restocking.history.title")}
      header={
        <ButtonCustom variant="primary" size="sm" onClick={handleExport} disabled={!view || view.rows.length === 0}>
          {t("restocking.history.export")}
        </ButtonCustom>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select value={productFilter} onChange={(e) => withPageReset(setProductFilter)(e.target.value)} className={INPUT_CLASS}>
          <option value={ALL}>{t("restocking.history.allProducts")}</option>
          {data?.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={supplierFilter} onChange={(e) => withPageReset(setSupplierFilter)(e.target.value)} className={INPUT_CLASS}>
          <option value={ALL}>{t("restocking.history.allSuppliers")}</option>
          {data?.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => withPageReset(setFrom)(e.target.value)} className={INPUT_CLASS} aria-label={t("restocking.history.from")} />
        <input type="date" value={to} onChange={(e) => withPageReset(setTo)(e.target.value)} className={INPUT_CLASS} aria-label={t("restocking.history.to")} />
      </div>

      {view && view.rows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <span>
            {t("restocking.history.summaryCount", { count: view.summary.count })} ·{" "}
            {t("restocking.history.summaryUnits", { count: view.summary.totalQuantity })}
          </span>
          <span>
            {t("restocking.history.summarySpent")}{" "}
            <span className="font-semibold text-foreground">{formatCurrency(view.summary.totalSpent)}</span>
          </span>
          {productFilter !== ALL && view.summary.minCost !== undefined && (
            <span>
              {t("restocking.history.summaryRange", {
                min: formatCurrency(view.summary.minCost),
                max: formatCurrency(view.summary.maxCost ?? view.summary.minCost),
              })}
            </span>
          )}
        </div>
      )}

      {!view ? (
        <p className="text-sm text-muted">{t("admin.salesHistory.loading")}</p>
      ) : view.rows.length === 0 ? (
        <p className="text-sm text-muted">{t("restocking.history.empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">{t("restocking.history.columnDate")}</th>
                  <th className="py-2 pr-3">{t("restocking.history.columnProduct")}</th>
                  <th className="py-2 pr-3">{t("restocking.history.columnSupplier")}</th>
                  <th className="py-2 pr-3 text-right">{t("restocking.history.columnQuantity")}</th>
                  <th className="py-2 pr-3 text-right">{t("restocking.history.columnUnitCost")}</th>
                  <th className="py-2 pr-3 text-right">{t("restocking.history.columnTotal")}</th>
                  <th className="py-2 text-right">{t("restocking.history.columnChange")}</th>
                </tr>
              </thead>
              <tbody>
                {pageView!.rows.map((p) => {
                  const change = view.changes.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-border">
                      <td className="py-2 pr-3 text-muted">{new Date(p.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-foreground">{productName(p.product_id)}</td>
                      <td className="py-2 pr-3 text-foreground">{supplierName(p.supplier_id)}</td>
                      <td className="py-2 pr-3 text-right text-foreground">{p.quantity}</td>
                      <td className="py-2 pr-3 text-right text-foreground">{formatCurrency(p.unit_cost)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-foreground">{formatCurrency(p.quantity * p.unit_cost)}</td>
                      <td className="py-2 text-right">
                        {change === undefined || Math.abs(change) < 0.05 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          // A price going UP is bad news for the buyer: red.
                          <span className={`inline-flex items-center gap-0.5 ${change > 0 ? "text-destructive" : "text-success"}`}>
                            {change > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
                            {Math.abs(change).toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={Math.min(page, pageView!.totalPages)}
            totalPages={pageView!.totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </CardCustom>
  );
}
