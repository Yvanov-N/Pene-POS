import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, MapPin, Phone, Star, User, History, Pencil, Plus, Trash2, X } from "lucide-react";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { buildProductOffers, summarizeSuppliers, supplierPriceTimeline } from "@/lib/purchaseStats";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Supplier, SupplierProduct } from "@/types/db";
import { OfferFormModal } from "./OfferFormModal";
import { SupplierFormModal } from "./SupplierFormModal";
import { INPUT_CLASS, SMALL_BUTTON_CLASS } from "./styles";

// Supplier directory: contact details, what each one sells and at what price,
// how much was bought from them, and on how many products they're cheapest.
export function SuppliersTab() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [offerModal, setOfferModal] = useState<{ supplierId: string; productId?: string } | null>(null);

  const data = useLiveQuery(async () => {
    const [suppliers, offers, purchases, products, history] = await Promise.all([
      db.suppliers.orderBy("name").toArray(),
      db.supplier_products.toArray(),
      db.stock_purchases.toArray(),
      db.products.toArray(),
      db.supplier_price_history.toArray(),
    ]);
    return { suppliers, offers, purchases, products, history };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const term = search.trim().toLowerCase();
    const suppliers = data.suppliers.filter(
      (s) =>
        !term ||
        [s.name, s.contact_name, s.phone, s.location].some((value) => (value ?? "").toLowerCase().includes(term)),
    );
    return {
      suppliers,
      summaries: summarizeSuppliers(data.suppliers, data.offers, data.purchases),
      productNames: new Map(data.products.map((p) => [p.id, p.name])),
    };
  }, [data, search]);

  const handleDelete = async (supplier: Supplier) => {
    const entry = makeOutboxEntry("generic_delete", "suppliers", { id: supplier.id });
    await commitLocal(db.suppliers, () => db.suppliers.delete(supplier.id), entry);
    void pushOutbox(entry);
    showToast("success", t("suppliers.deleteSuccessToast", { name: supplier.name }));
  };

  const handleDeleteOffer = async (offer: SupplierProduct) => {
    const entry = makeOutboxEntry("generic_delete", "supplier_products", { id: offer.id });
    await commitLocal(db.supplier_products, () => db.supplier_products.delete(offer.id), entry);
    void pushOutbox(entry);
  };

  return (
    <CardCustom
      title={t("suppliers.title")}
      header={
        <ButtonCustom variant="primary" size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("suppliers.add")}
        </ButtonCustom>
      }
    >
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("suppliers.searchPlaceholder")}
        className={`${INPUT_CLASS} mb-4`}
      />

      {!view || !data ? (
        <p className="text-sm text-muted">{t("admin.salesHistory.loading")}</p>
      ) : view.suppliers.length === 0 ? (
        <p className="text-sm text-muted">{t("suppliers.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {view.suppliers.map((supplier) => {
            const summary = view.summaries.get(supplier.id);
            const isExpanded = expandedId === supplier.id;
            const supplierProductIds = new Set([
              ...data.offers.filter((o) => o.supplier_id === supplier.id).map((o) => o.product_id),
              ...data.purchases.filter((p) => p.supplier_id === supplier.id).map((p) => p.product_id),
            ]);

            return (
              <li key={supplier.id} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : supplier.id)}
                  className="flex w-full items-start gap-3 p-3 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                      {supplier.name}
                      {summary && summary.cheapestOn > 0 && (
                        <span className="badge-green inline-flex items-center gap-1">
                          <Star className="h-3 w-3" aria-hidden />
                          {t("suppliers.cheapestOn", { count: summary.cheapestOn })}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      {supplier.contact_name && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" aria-hidden />
                          {supplier.contact_name}
                        </span>
                      )}
                      {supplier.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" aria-hidden />
                          {supplier.phone}
                        </span>
                      )}
                      {supplier.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {supplier.location}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted">
                    <p className="text-sm font-semibold text-foreground">{formatCurrency(summary?.totalSpent ?? 0)}</p>
                    <p>{t("suppliers.purchaseCount", { count: summary?.purchaseCount ?? 0 })}</p>
                  </div>
                </button>

                {isExpanded && (
                  <div className="flex flex-col gap-3 border-t border-border p-3">
                    {supplier.notes && <p className="text-sm text-muted">{supplier.notes}</p>}

                    <div className="flex flex-wrap gap-2">
                      {supplier.phone && (
                        <a href={`tel:${supplier.phone}`} className={SMALL_BUTTON_CLASS}>
                          {t("suppliers.call")}
                        </a>
                      )}
                      <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setOfferModal({ supplierId: supplier.id })}>
                        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {t("suppliers.addOffer")}
                      </button>
                      <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setEditing(supplier)}>
                        <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {t("suppliers.edit")}
                      </button>
                      <ButtonCustom
                        variant="danger"
                        size="sm"
                        requiresAdminPin
                        pinModalTitle={t("suppliers.deletePinTitle")}
                        onClick={() => void handleDelete(supplier)}
                      >
                        <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {t("suppliers.delete")}
                      </ButtonCustom>
                    </div>

                    {supplierProductIds.size === 0 ? (
                      <p className="text-sm text-muted">{t("suppliers.noProducts")}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                              <th className="py-2 pr-3">{t("suppliers.productLabel")}</th>
                              <th className="py-2 pr-3 text-right">{t("suppliers.offerPriceLabel")}</th>
                              <th className="py-2 pr-3 text-right">{t("restocking.history.columnChange")}</th>
                              <th className="py-2 pr-3 text-right">{t("suppliers.bestElsewhere")}</th>
                              <th className="py-2 text-right" />
                            </tr>
                          </thead>
                          <tbody>
                            {[...supplierProductIds].map((productId) => {
                              const ranked = buildProductOffers(productId, data.suppliers, data.offers, data.purchases);
                              const own = ranked.find((r) => r.supplier.id === supplier.id);
                              const bestOther = ranked.find((r) => r.supplier.id !== supplier.id);
                              const offer = data.offers.find((o) => o.supplier_id === supplier.id && o.product_id === productId);
                              const timeline = supplierPriceTimeline(data.history, supplier.id, productId);
                              const change = timeline[0]?.changePct;
                              return (
                                <tr key={productId} className="border-b border-border">
                                  <td className="py-2 pr-3 text-foreground">
                                    {view.productNames.get(productId) ?? t("restocking.history.deletedProduct")}
                                    {own?.isBest && ranked.length > 1 && (
                                      <Star className="ml-1 inline h-3 w-3 text-success" aria-label={t("suppliers.bestPrice")} />
                                    )}
                                  </td>
                                  <td className="py-2 pr-3 text-right font-semibold text-foreground">
                                    {own?.effectivePrice !== undefined ? formatCurrency(own.effectivePrice) : "—"}
                                  </td>
                                  <td className="py-2 pr-3 text-right">
                                    {change === undefined || Math.abs(change) < 0.05 ? (
                                      <span className="text-muted">—</span>
                                    ) : (
                                      <span
                                        className={`inline-flex items-center gap-0.5 text-xs ${change > 0 ? "text-destructive" : "text-success"}`}
                                        title={t("suppliers.pricePointsCount", { count: timeline.length })}
                                      >
                                        {change > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
                                        {Math.abs(change).toFixed(1)}%
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 pr-3 text-right text-muted">
                                    {bestOther?.effectivePrice !== undefined
                                      ? `${formatCurrency(bestOther.effectivePrice)} (${bestOther.supplier.name})`
                                      : "—"}
                                  </td>
                                  <td className="py-2 text-right">
                                    <div className="flex justify-end gap-2">
                                      <button
                                        type="button"
                                        className={SMALL_BUTTON_CLASS}
                                        onClick={() => setOfferModal({ supplierId: supplier.id, productId })}
                                      >
                                        <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                        {t("suppliers.editOffer")}
                                      </button>
                                      {offer && (
                                        <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => void handleDeleteOffer(offer)}>
                                          <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                          {t("suppliers.removeOffer")}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <SupplierFormModal supplier={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {offerModal && (
        <OfferFormModal supplierId={offerModal.supplierId} productId={offerModal.productId} onClose={() => setOfferModal(null)} />
      )}
    </CardCustom>
  );
}
