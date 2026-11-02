import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Phone, MapPin, Star, History, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { buildPriceSeries, buildProductOffers, summarizePurchases, supplierPriceTimeline } from "@/lib/purchaseStats";
import type { Product } from "@/types/db";
import { OfferFormModal } from "./OfferFormModal";
import { SMALL_BUTTON_CLASS } from "./styles";

const LINE_COLORS = [
  "hsl(var(--accent))",
  "hsl(var(--green))",
  "hsl(var(--blue))",
  "hsl(var(--amber))",
  "hsl(var(--orange))",
];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}

interface ProductSupplierPanelProps {
  product: Product;
}

// "Who sells me this, and at what price?" for one product: price summary,
// suppliers ranked cheapest first, and purchase price over time.
export function ProductSupplierPanel({ product }: ProductSupplierPanelProps) {
  const { t } = useTranslation();
  const [offerModal, setOfferModal] = useState<{ supplierId?: string } | null>(null);

  const data = useLiveQuery(async () => {
    const [suppliers, offers, purchases, history] = await Promise.all([
      db.suppliers.toArray(),
      db.supplier_products.where("product_id").equals(product.id).toArray(),
      db.stock_purchases.where("product_id").equals(product.id).toArray(),
      db.supplier_price_history.where("product_id").equals(product.id).toArray(),
    ]);
    return { suppliers, offers, purchases, history };
  }, [product.id]);

  const view = useMemo(() => {
    if (!data) return null;
    const supplierNames = new Map(data.suppliers.map((s) => [s.id, s.name]));
    return {
      offers: buildProductOffers(product.id, data.suppliers, data.offers, data.purchases),
      summary: summarizePurchases(data.purchases),
      series: buildPriceSeries(product.id, data.history),
      // Latest price change per supplier, shown next to its current price.
      lastChange: new Map(
        data.suppliers.map((s) => [s.id, supplierPriceTimeline(data.history, s.id, product.id)[0]?.changePct]),
      ),
      supplierNames,
    };
  }, [data, product.id]);

  if (!view) return null;

  const lastCost = view.summary.lastCost ?? product.cost_price;
  const margin = lastCost !== undefined ? product.price - lastCost : undefined;
  const marginPct = margin !== undefined && product.price > 0 ? (margin / product.price) * 100 : undefined;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("suppliers.panelTitle")}</h3>
        <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setOfferModal({})}>
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("suppliers.addOffer")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">{t("suppliers.lastCost")}</p>
          <p className="font-semibold text-foreground">{lastCost !== undefined ? formatCurrency(lastCost) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("suppliers.minCost")}</p>
          <p className="font-semibold text-foreground">
            {view.summary.minCost !== undefined ? formatCurrency(view.summary.minCost) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("suppliers.avgCost")}</p>
          <p className="font-semibold text-foreground">
            {view.summary.averageCost !== undefined ? formatCurrency(view.summary.averageCost) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("suppliers.unitMargin")}</p>
          <p className={`font-semibold ${margin !== undefined && margin <= 0 ? "text-destructive" : "text-foreground"}`}>
            {margin !== undefined ? `${formatCurrency(margin)} (${Math.round(marginPct ?? 0)}%)` : "—"}
          </p>
        </div>
      </div>

      {view.offers.length === 0 ? (
        <p className="text-sm text-muted">{t("suppliers.noOffers")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {view.offers.map((row) => (
            <li key={row.supplier.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <span className="truncate">{row.supplier.name}</span>
                  {row.isBest && view.offers.length > 1 && (
                    <span className="badge-green inline-flex items-center gap-1">
                      <Star className="h-3 w-3" aria-hidden />
                      {t("suppliers.bestPrice")}
                    </span>
                  )}
                </p>
                <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                  {row.supplier.phone && (
                    <a href={`tel:${row.supplier.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                      <Phone className="h-3 w-3" aria-hidden />
                      {row.supplier.phone}
                    </a>
                  )}
                  {row.supplier.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden />
                      {row.supplier.location}
                    </span>
                  )}
                  {row.lastPurchaseAt && (
                    <span>
                      {t("suppliers.lastPaidOn", {
                        price: formatCurrency(row.lastPaid ?? 0),
                        date: shortDate(row.lastPurchaseAt),
                      })}
                    </span>
                  )}
                </p>
              </div>
              <span className="flex flex-col items-end">
                <span className="font-semibold text-foreground">
                  {row.effectivePrice !== undefined ? formatCurrency(row.effectivePrice) : "—"}
                </span>
                {(() => {
                  const change = view.lastChange.get(row.supplier.id);
                  if (change === undefined || Math.abs(change) < 0.05) return null;
                  return (
                    <span className={`inline-flex items-center gap-0.5 text-xs ${change > 0 ? "text-destructive" : "text-success"}`}>
                      {change > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
                      {Math.abs(change).toFixed(1)}%
                    </span>
                  );
                })()}
              </span>
              <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setOfferModal({ supplierId: row.supplier.id })}>
                <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("suppliers.editOffer")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {view.series.points.length > 1 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("suppliers.priceTrend")}</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={view.series.points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: "hsl(var(--muted))", fontSize: 11 }}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
              />
              <YAxis tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                labelFormatter={(value) => new Date(String(value)).toLocaleDateString()}
                formatter={(value, name) => [formatCurrency(Number(value)), view.supplierNames.get(String(name)) ?? name]}
                contentStyle={{
                  background: "hsl(var(--surface))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend formatter={(value) => view.supplierNames.get(String(value)) ?? value} wrapperStyle={{ fontSize: 12 }} />
              {view.series.supplierIds.map((supplierId, index) => (
                <Line
                  key={supplierId}
                  type="monotone"
                  dataKey={supplierId}
                  stroke={LINE_COLORS[index % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {offerModal && (
        <OfferFormModal productId={product.id} supplierId={offerModal.supplierId} onClose={() => setOfferModal(null)} />
      )}
    </div>
  );
}
