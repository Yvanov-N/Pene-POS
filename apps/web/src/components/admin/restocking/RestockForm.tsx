import { useMemo, useRef, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { TFunction } from "i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { MONEY_DECIMALS, numberSchema } from "@/lib/validation";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import { BarcodeInput, type BarcodeInputHandle } from "@/components/pos/BarcodeInput";
import { buildProductOffers } from "@/lib/purchaseStats";
import type { Product, StockPurchase } from "@/types/db";
import { ProductSupplierPanel } from "./ProductSupplierPanel";
import { SupplierFormModal } from "./SupplierFormModal";
import { INPUT_CLASS, SMALL_BUTTON_CLASS } from "./styles";
import { ProductThumb } from "@/components/ui/product-thumb";
import { AmountInput } from "@/components/ui/amount-input";
import { parseAmount, roundMoney } from "@/lib/money";

const QUICK_ADD_AMOUNTS = [10, 24, 50, 100] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
// Mirrors ProductGrid.tsx's own EXPIRY_WARNING_DAYS -- kept as a separate
// local constant since that file doesn't export it.
const EXPIRY_WARNING_DAYS = 7;

function getExpiryBadge(t: TFunction, expiryDate?: string): { label: string; className: string } | null {
  if (!expiryDate) return null;
  const daysLeft = (new Date(expiryDate).getTime() - Date.now()) / DAY_MS;
  if (daysLeft < 0) return { label: t("pos.grid.expired"), className: "badge-red" };
  if (daysLeft <= EXPIRY_WARNING_DAYS) return { label: t("pos.grid.expiringSoon"), className: "badge-red" };
  return null;
}

interface FormValues {
  quantity: number;
  expiryInput: string;
  supplierId: string;
  unitCost: number | string;
}

export function RestockForm() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Product | null>(null);
  const [nameSearch, setNameSearch] = useState("");
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const barcodeInputRef = useRef<BarcodeInputHandle>(null);

  // The selected product's suppliers, cheapest first, then every other
  // supplier -- so the usual supplier is one click away but any can be used.
  const supplierChoices = useLiveQuery(async () => {
    const suppliers = await db.suppliers.orderBy("name").toArray();
    if (!selected) return { ranked: [], others: suppliers };
    const [offers, purchases] = await Promise.all([
      db.supplier_products.where("product_id").equals(selected.id).toArray(),
      db.stock_purchases.where("product_id").equals(selected.id).toArray(),
    ]);
    const ranked = buildProductOffers(selected.id, suppliers, offers, purchases);
    const rankedIds = new Set(ranked.map((row) => row.supplier.id));
    return { ranked, others: suppliers.filter((s) => !rankedIds.has(s.id)) };
  }, [selected?.id]);

  const handleUnknownBarcode = () => {
    showToast(
      "warning",
      t("restocking.unknownBarcodeToast"),
      6000,
      { label: t("restocking.goToCatalog"), onClick: () => navigate("/admin/products") },
    );
  };

  const nameMatches = useLiveQuery(async () => {
    const term = nameSearch.trim().toLowerCase();
    if (!term) return [];
    const products = await db.products.toArray();
    return products.filter((product) => product.name.toLowerCase().includes(term)).slice(0, 6);
  }, [nameSearch]);

  const expiryBadge = useMemo(() => (selected ? getExpiryBadge(t, selected.expiry_date) : null), [t, selected]);

  const formik = useFormik<FormValues>({
    initialValues: { quantity: 0, expiryInput: "", supplierId: "", unitCost: "" },
    validationSchema: Yup.object({
      quantity: numberSchema(t("restocking.errorQuantityInvalid"), { integer: true, moreThan: 0 }),
      expiryInput: Yup.string(),
      supplierId: Yup.string().required(t("restocking.errorSupplierRequired")),
      unitCost: numberSchema(t("restocking.errorUnitCostInvalid"), { min: 0, decimals: MONEY_DECIMALS }),
    }),
    onSubmit: async (values) => {
      if (!selected) return;
      const fresh = await db.products.get(selected.id);
      if (!fresh) {
        showToast("error", t("restocking.productGoneError"));
        setSelected(null);
        return;
      }

      // One record_restock RPC (migration 00036) does the purchase row, the
      // atomic stock delta, cost_price and the supplier's offer server-side.
      // Stock stays a delta, never a whole-row write, for the same reason
      // as before: a sale on another terminal between this read and the
      // push must not be overwritten. The purchase row's id is the
      // operationId, so the pulled server row replaces this optimistic one.
      const unitCost = parseAmount(values.unitCost);
      const nextExpiry = values.expiryInput ? new Date(values.expiryInput).toISOString() : fresh.expiry_date;
      const now = new Date().toISOString();
      const updated: Product = {
        ...fresh,
        stock: fresh.stock + values.quantity,
        cost_price: unitCost,
        expiry_date: nextExpiry,
        updated_at: now,
      };

      const entry = makeOutboxEntry("record_restock", "stock_purchases", {
        product_id: selected.id,
        supplier_id: values.supplierId,
        quantity: values.quantity,
        unit_cost: unitCost,
        // Only sent when it changed -- the RPC keeps the current expiry on null.
        expiry_date: nextExpiry !== fresh.expiry_date ? (nextExpiry ?? null) : null,
      });
      const purchase: StockPurchase = {
        id: entry.operationId,
        product_id: selected.id,
        supplier_id: values.supplierId,
        quantity: values.quantity,
        unit_cost: unitCost,
        total_cost: roundMoney(values.quantity * unitCost),
        expiry_date: nextExpiry,
        created_at: now,
        updated_at: now,
      };

      await db.transaction(
        "rw",
        [db.products, db.stock_purchases, db.supplier_products, db.supplier_price_history, db.sync_outbox],
        async () => {
          await db.products.put(updated);
          await db.stock_purchases.put(purchase);
          // Same id the RPC gives the server row (migration 00038), so the pull
          // replaces this one instead of adding a twin.
          await db.supplier_price_history.put({
            id: entry.operationId,
            supplier_id: values.supplierId,
            product_id: selected.id,
            price: unitCost,
            source: "restock",
            recorded_at: now,
            updated_at: now,
          });
          // Mirror the RPC's offer upsert only for an existing offer: a new one
          // gets its id server-side and arrives with the next pull.
          const offer = await db.supplier_products
            .where("product_id")
            .equals(selected.id)
            .filter((o) => o.supplier_id === values.supplierId)
            .first();
          if (offer) await db.supplier_products.put({ ...offer, price: unitCost, updated_at: now });
          await recordOutbox(entry);
        },
      );

      const outcome = await pushOutbox(entry);
      if (outcome !== "synced") {
        showToast("warning", t("sync.offlineFallbackToast"));
      }

      showToast("success", t("restocking.successToast", { name: updated.name, quantity: values.quantity }));
      setSelected(null);
      formik.resetForm({ values: { quantity: 0, expiryInput: "", supplierId: "", unitCost: "" } });
      // Ready for the next box immediately -- BarcodeInput itself only
      // refocuses on its own scan events, not on this page's own submit
      // action, so without this the manager would have to click back into
      // the field before the next scan is picked up as text input focus
      // (background keyboard-emulation detection still works either way,
      // but hardware HID/serial + the visual caret shouldn't require it).
      barcodeInputRef.current?.focus();
    },
  });

  const selectProduct = async (product: Product) => {
    setSelected(product);
    setNameSearch("");
    // Pre-select the cheapest known supplier at its price; the manager only
    // has to change it when buying elsewhere.
    const [suppliers, offers, purchases] = await Promise.all([
      db.suppliers.toArray(),
      db.supplier_products.where("product_id").equals(product.id).toArray(),
      db.stock_purchases.where("product_id").equals(product.id).toArray(),
    ]);
    const best = buildProductOffers(product.id, suppliers, offers, purchases)[0];
    formik.resetForm({
      values: {
        quantity: 0,
        expiryInput: product.expiry_date?.slice(0, 10) ?? "",
        supplierId: best?.supplier.id ?? "",
        unitCost: best?.effectivePrice ?? product.cost_price ?? "",
      },
    });
  };

  const changeSupplier = (supplierId: string) => {
    void formik.setFieldValue("supplierId", supplierId);
    const row = supplierChoices?.ranked.find((r) => r.supplier.id === supplierId);
    if (row?.effectivePrice !== undefined) void formik.setFieldValue("unitCost", row.effectivePrice);
  };

  // Live preview only -- an unparseable entry ("12,") just hides it.
  const parsedCost = formik.values.unitCost === "" ? Number.NaN : parseAmount(formik.values.unitCost);
  const unitCostValue = Number.isFinite(parsedCost) ? parsedCost : undefined;
  const lineTotal = unitCostValue !== undefined ? roundMoney(unitCostValue * (Number(formik.values.quantity) || 0)) : undefined;
  const unitMargin = selected && unitCostValue !== undefined ? roundMoney(selected.price - unitCostValue) : undefined;

  return (
    <>
      <CardCustom title={t("restocking.title")}>
        <div className="flex flex-col gap-4">
          <BarcodeInput ref={barcodeInputRef} onProductSelect={(product) => void selectProduct(product)} onNotFound={handleUnknownBarcode} />

          <div className="relative">
            <input
              type="text"
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              placeholder={t("restocking.searchPlaceholder")}
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            />
            {nameSearch.trim() && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                {nameMatches === undefined || nameMatches.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted">{t("restocking.noMatches")}</li>
                ) : (
                  nameMatches.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => void selectProduct(product)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface2"
                      >
                        <span aria-hidden>{product.emoji || "📦"}</span>
                        <span className="text-foreground">{product.name}</span>
                        <span className="ml-auto text-xs text-muted">
                          {t("pos.grid.stockLabel", { count: product.stock })}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          {!selected ? (
            <p className="text-sm text-muted">{t("restocking.noProductSelected")}</p>
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
              <div className="flex items-center gap-3">
                <ProductThumb product={selected} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-foreground">{selected.name}</p>
                  <p className="text-sm text-muted">
                    {formatCurrency(selected.price)} · {t("restocking.currentStock", { count: selected.stock })}
                  </p>
                </div>
                {expiryBadge && <span className={expiryBadge.className}>{expiryBadge.label}</span>}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm text-muted">{t("restocking.quantityLabel")}</span>
                <div className="flex flex-wrap gap-2">
                  {QUICK_ADD_AMOUNTS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => formik.setFieldValue("quantity", (Number(formik.values.quantity) || 0) + amount)}
                      className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent"
                    >
                      +{amount}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  name="quantity"
                  value={formik.values.quantity}
                  onChange={(e) => formik.setFieldValue("quantity", Number(e.target.value))}
                  onBlur={formik.handleBlur}
                  className="w-32 rounded-lg border border-border bg-surface2 px-3 py-2 text-lg font-semibold text-foreground"
                />
                <FieldError touched={formik.touched.quantity} error={formik.errors.quantity} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted">{t("restocking.supplierLabel")}</span>
                    <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setShowSupplierModal(true)}>
                      {t("restocking.newSupplier")}
                    </button>
                  </div>
                  <select
                    name="supplierId"
                    value={formik.values.supplierId}
                    onChange={(e) => changeSupplier(e.target.value)}
                    onBlur={formik.handleBlur}
                    className={INPUT_CLASS}
                  >
                    <option value="">{t("suppliers.choose")}</option>
                    {supplierChoices && supplierChoices.ranked.length > 0 && (
                      <optgroup label={t("restocking.knownSuppliers")}>
                        {supplierChoices.ranked.map((row) => (
                          <option key={row.supplier.id} value={row.supplier.id}>
                            {row.supplier.name}
                            {row.effectivePrice !== undefined ? ` — ${formatCurrency(row.effectivePrice)}` : ""}
                            {row.isBest && supplierChoices.ranked.length > 1 ? " ★" : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {supplierChoices && supplierChoices.others.length > 0 && (
                      <optgroup label={t("restocking.otherSuppliers")}>
                        {supplierChoices.others.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <FieldError touched={formik.touched.supplierId} error={formik.errors.supplierId} />
                </div>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">{t("restocking.unitCostLabel")}</span>
                  <AmountInput
                    name="unitCost"
                    value={formik.values.unitCost}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className={INPUT_CLASS}
                  />
                  <FieldError touched={formik.touched.unitCost} error={formik.errors.unitCost} />
                </label>
              </div>

              {lineTotal !== undefined && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-surface2 px-3 py-2 text-sm">
                  <span className="text-muted">
                    {t("restocking.lineTotal")} <span className="font-semibold text-foreground">{formatCurrency(lineTotal)}</span>
                  </span>
                  {unitMargin !== undefined && (
                    <span className="text-muted">
                      {t("restocking.unitMargin")}{" "}
                      <span className={`font-semibold ${unitMargin <= 0 ? "text-destructive" : "text-success"}`}>
                        {formatCurrency(unitMargin)}
                        {selected.price > 0 ? ` (${Math.round((unitMargin / selected.price) * 100)}%)` : ""}
                      </span>
                    </span>
                  )}
                  {unitMargin !== undefined && unitMargin <= 0 && (
                    <span className="text-destructive">{t("restocking.costAbovePriceWarning")}</span>
                  )}
                </div>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("restocking.expiryLabel")}</span>
                <input
                  type="date"
                  name="expiryInput"
                  value={formik.values.expiryInput}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>

              <ButtonCustom
                variant="success"
                size="lg"
                disabled={!selected}
                isLoading={formik.isSubmitting}
                onClick={() => void formik.submitForm()}
              >
                {t("restocking.validate")}
              </ButtonCustom>
            </div>
          )}

          {selected && <ProductSupplierPanel product={selected} />}
        </div>
      </CardCustom>

      {showSupplierModal && (
        <SupplierFormModal
          onClose={() => setShowSupplierModal(false)}
          onSaved={(supplier) => {
            void formik.setFieldValue("supplierId", supplier.id);
          }}
        />
      )}
    </>
  );
}
