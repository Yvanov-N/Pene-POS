import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Package, Receipt, TrendingUp, Wallet, X } from "lucide-react";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { STATUS_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import { paginate } from "@/lib/pagination";
import { usePageSize } from "@/hooks/usePageSize";
import { PaginationControls } from "@/components/admin/PaginationControls";
import { isRevenueRelevant, totalsByProduct } from "@/lib/salesAggregation";
import { priceChangeByPurchase, summarizePurchases } from "@/lib/purchaseStats";
import { StatCard } from "@/components/admin/StatCard";
import { PaymentChip } from "@/components/ui/payment-chip";
import { ProductSupplierPanel } from "@/components/admin/restocking/ProductSupplierPanel";
import type { Product } from "@/types/db";
import { ProductThumb } from "@/components/ui/product-thumb";
import { purchaseLineTotal } from "@/lib/money";

const TABS = ["summary", "sales", "restocks"] as const;
type Tab = (typeof TABS)[number];

const PILL_CLASS = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface2 text-muted hover:text-foreground"
  }`;

interface ProductDetailDrawerProps {
  product: Product;
  onClose: () => void;
}

// Everything about one product from the Stocks page: what it sold, what it
// earned, and how it was restocked (suppliers + purchase prices).
export function ProductDetailDrawer({ product: initialProduct, onClose }: ProductDetailDrawerProps) {
  const { t } = useTranslation();
  // Live, so a restock or price edit made while the drawer is open shows up.
  const product = useLiveQuery(() => db.products.get(initialProduct.id), [initialProduct.id]) ?? initialProduct;
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("summary");
  const [salesPage, setSalesPage] = useState(1);
  const [salesPageSize, setSalesPageSize] = usePageSize("productSales");

  const data = useLiveQuery(async () => {
    const [items, purchases, suppliers, students] = await Promise.all([
      db.sale_items.where("product_id").equals(product.id).toArray(),
      db.stock_purchases.where("product_id").equals(product.id).toArray(),
      db.suppliers.toArray(),
      db.student_wallets.toArray(),
    ]);
    const sales = await db.sales.bulkGet([...new Set(items.map((item) => item.sale_id))]);
    return {
      items,
      purchases,
      sales: new Map(sales.flatMap((sale) => (sale ? [[sale.id, sale] as const] : []))),
      supplierNames: new Map(suppliers.map((s) => [s.id, s.name])),
      studentNames: new Map(students.map((s) => [s.id, s.student_name])),
    };
  }, [product.id]);

  const view = useMemo(() => {
    if (!data) return null;
    const lines = data.items
      .map((item) => ({ item, sale: data.sales.get(item.sale_id) }))
      .filter((line): line is { item: (typeof data.items)[number]; sale: NonNullable<typeof line.sale> } => !!line.sale)
      .sort((a, b) => b.sale.created_at.localeCompare(a.sale.created_at));
    // Refunded / rejected-MoMo sales are listed but don't count as sold.
    const counted = lines.filter((line) => isRevenueRelevant(line.sale)).map((line) => line.item);
    const totals = totalsByProduct(counted).get(product.id);
    return {
      lines,
      totals,
      lastSaleAt: lines.find((line) => isRevenueRelevant(line.sale))?.sale.created_at,
      purchases: [...data.purchases].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      purchaseSummary: summarizePurchases(data.purchases),
      priceChanges: priceChangeByPurchase(data.purchases),
    };
  }, [data, product.id]);

  const margin = product.cost_price !== undefined ? product.price - product.cost_price : undefined;
  const marginPct = margin !== undefined && product.price > 0 ? Math.round((margin / product.price) * 100) : undefined;
  const profitMargin =
    view?.totals && view.totals.costedRevenue > 0 ? Math.round((view.totals.profit / view.totals.costedRevenue) * 100) : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumb product={product} size="md" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-foreground">{product.name}</h2>
              <p className="text-xs text-muted">
                {formatCurrency(product.price)} · {t("pos.grid.stockLabel", { count: product.stock })}
                {product.cost_price !== undefined && (
                  <>
                    {" · "}
                    {t("admin.products.detail.costAndMargin", {
                      cost: formatCurrency(product.cost_price),
                      margin: formatCurrency(margin ?? 0),
                      pct: marginPct ?? 0,
                    })}
                  </>
                )}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-muted hover:text-foreground" aria-label={t("pos.pin.close")}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {TABS.map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={PILL_CLASS(tab === key)}>
              {t(`admin.products.detail.tabs.${key}`)}
            </button>
          ))}
        </div>

        {!view ? (
          <p className="text-sm text-muted">{t("admin.products.loading")}</p>
        ) : tab === "summary" ? (
          <div className="flex flex-col gap-4">
            <div className="stat-grid-compact">
              <StatCard
                icon={<Package className="h-5 w-5" />}
                label={t("admin.products.detail.quantitySold")}
                value={view.totals?.quantitySold ?? 0}
                sub={
                  view.lastSaleAt
                    ? t("admin.products.detail.lastSale", { date: new Date(view.lastSaleAt).toLocaleDateString() })
                    : t("admin.products.detail.neverSold")
                }
              />
              <StatCard
                icon={<Wallet className="h-5 w-5" />}
                label={t("admin.products.detail.revenue")}
                value={view.totals?.revenue ?? 0}
                formatValue={formatCurrency}
              />
              <StatCard
                icon={<TrendingUp className="h-5 w-5" />}
                label={t("admin.products.detail.profit")}
                value={view.totals?.profit ?? 0}
                formatValue={formatCurrency}
                valueClassName={(view.totals?.profit ?? 0) < 0 ? "text-destructive" : "text-success"}
                sub={
                  <>
                    {profitMargin !== null && t("admin.dashboard.marginSub", { pct: profitMargin })}
                    {view.totals && view.totals.uncostedQuantity > 0 && (
                      <span className="block">
                        {t("admin.dashboard.profit.uncostedUnits", { count: view.totals.uncostedQuantity })}
                      </span>
                    )}
                  </>
                }
              />
              <StatCard
                icon={<Receipt className="h-5 w-5" />}
                label={t("admin.products.detail.purchased")}
                value={view.purchaseSummary.totalQuantity}
                sub={
                  view.purchaseSummary.count > 0
                    ? t("admin.products.detail.purchasedSub", {
                        count: view.purchaseSummary.count,
                        spent: formatCurrency(view.purchaseSummary.totalSpent),
                      })
                    : t("admin.products.detail.neverPurchased")
                }
              />
            </div>
          </div>
        ) : tab === "sales" ? (
          view.lines.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.products.detail.noSales")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {paginate(view.lines, salesPage, salesPageSize).rows.map(({ item, sale }) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/history?q=${sale.id}`)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface2"
                      title={t("admin.products.detail.openSale")}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted">{new Date(sale.created_at).toLocaleString()}</p>
                        <p className="text-foreground">
                          {item.quantity} x {formatCurrency(item.unit_price)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <PaymentChip
                            method={sale.payment_method}
                            studentName={sale.student_id ? data?.studentNames.get(sale.student_id) : undefined}
                          />
                          {sale.status !== "completed" && (
                            <span className={STATUS_BADGE_CLASS[sale.status]}>{t(`admin.salesHistory.status.${sale.status}`)}</span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 font-semibold text-foreground">{formatCurrency(item.quantity * item.unit_price)}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <PaginationControls
                page={salesPage}
                totalPages={paginate(view.lines, salesPage, salesPageSize).totalPages}
                onPageChange={setSalesPage}
                pageSize={salesPageSize}
                onPageSizeChange={setSalesPageSize}
              />
            </div>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <ProductSupplierPanel product={product} />
            {view.purchases.length === 0 ? (
              <p className="text-sm text-muted">{t("restocking.history.empty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {view.purchases.map((purchase) => {
                  const change = view.priceChanges.get(purchase.id);
                  return (
                    <li key={purchase.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted">{new Date(purchase.created_at).toLocaleString()}</p>
                        <p className="truncate text-foreground">
                          {data?.supplierNames.get(purchase.supplier_id) ?? t("restocking.history.deletedSupplier")}
                        </p>
                        <p className="text-xs text-muted">
                          {purchase.quantity} x {formatCurrency(purchase.unit_cost)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold text-foreground">{formatCurrency(purchaseLineTotal(purchase.quantity, purchase.unit_cost))}</p>
                        {change !== undefined && Math.abs(change) >= 0.05 && (
                          <p className={`inline-flex items-center gap-0.5 text-xs ${change > 0 ? "text-destructive" : "text-success"}`}>
                            {change > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
                            {Math.abs(change).toFixed(1)}%
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
