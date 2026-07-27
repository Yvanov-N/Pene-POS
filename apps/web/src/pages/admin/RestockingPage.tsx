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
import { numberSchema } from "@/lib/validation";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import { BarcodeInput, type BarcodeInputHandle } from "@/components/pos/BarcodeInput";
import type { Product } from "@/types/db";

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
}

export function RestockingPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Product | null>(null);
  const [nameSearch, setNameSearch] = useState("");
  const barcodeInputRef = useRef<BarcodeInputHandle>(null);

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
    initialValues: { quantity: 0, expiryInput: "" },
    validationSchema: Yup.object({
      quantity: numberSchema(t("restocking.errorQuantityInvalid"), { integer: true, moreThan: 0 }),
      expiryInput: Yup.string(),
    }),
    onSubmit: async (values) => {
      if (!selected) return;
      const fresh = await db.products.get(selected.id);
      if (!fresh) {
        showToast("error", t("restocking.productGoneError"));
        setSelected(null);
        return;
      }

      // Stock is pushed as an atomic delta (adjust_product_stock), not part
      // of a whole-row update -- the old code here read `fresh.stock` into a
      // local snapshot and pushed `stock: fresh.stock + quantity` back as a
      // last-write-wins UPDATE, the same stale-clobber shape confirmed
      // elsewhere (refundService.voidSale, MoMoVerificationCard's reject
      // flow) as a real cause of stock mismatches: a sale ringing up on
      // another terminal between this read and this write would be silently
      // overwritten. expiry_date has no such concurrent-writer risk (nothing
      // else in this app ever changes it), so it stays a plain field update,
      // only pushed at all when it actually changed.
      const nextExpiry = values.expiryInput ? new Date(values.expiryInput).toISOString() : fresh.expiry_date;
      const expiryChanged = nextExpiry !== fresh.expiry_date;
      const updated: Product = {
        ...fresh,
        stock: fresh.stock + values.quantity,
        expiry_date: nextExpiry,
        updated_at: new Date().toISOString(),
      };

      const stockEntry = makeOutboxEntry("adjust_product_stock", "products", {
        product_id: selected.id,
        delta: values.quantity,
        reason: "restock",
      });
      const expiryEntry = expiryChanged
        ? makeOutboxEntry("generic_update", "products", { id: selected.id, expiry_date: nextExpiry ?? null })
        : null;

      await db.transaction("rw", db.products, db.sync_outbox, async () => {
        await db.products.put(updated);
        await recordOutbox(stockEntry);
        if (expiryEntry) await recordOutbox(expiryEntry);
      });

      const outcomes = await Promise.all([pushOutbox(stockEntry), ...(expiryEntry ? [pushOutbox(expiryEntry)] : [])]);
      if (outcomes.some((outcome) => outcome !== "synced")) {
        showToast("warning", t("sync.offlineFallbackToast"));
      }

      showToast("success", t("restocking.successToast", { name: updated.name, quantity: values.quantity }));
      setSelected(null);
      formik.resetForm({ values: { quantity: 0, expiryInput: "" } });
      // Ready for the next box immediately -- BarcodeInput itself only
      // refocuses on its own scan events, not on this page's own submit
      // action, so without this the manager would have to click back into
      // the field before the next scan is picked up as text input focus
      // (background keyboard-emulation detection still works either way,
      // but hardware HID/serial + the visual caret shouldn't require it).
      barcodeInputRef.current?.focus();
    },
  });

  const selectProduct = (product: Product) => {
    setSelected(product);
    formik.resetForm({ values: { quantity: 0, expiryInput: product.expiry_date?.slice(0, 10) ?? "" } });
    setNameSearch("");
  };

  return (
    <div className="mx-auto max-w-2xl p-4">
      <CardCustom title={t("restocking.title")}>
        <div className="flex flex-col gap-4">
          <BarcodeInput ref={barcodeInputRef} onProductSelect={selectProduct} onNotFound={handleUnknownBarcode} />

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
                        onClick={() => selectProduct(product)}
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
                {selected.image_url ? (
                  <img src={selected.image_url} alt="" className="h-14 w-14 rounded-md object-cover" />
                ) : (
                  <span className="text-4xl" aria-hidden>
                    {selected.emoji || "📦"}
                  </span>
                )}
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
        </div>
      </CardCustom>
    </div>
  );
}
