import { useMemo } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownRight, ArrowUpRight, Trash2, X, Save } from "lucide-react";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { MONEY_DECIMALS, numberSchema } from "@/lib/validation";
import { supplierPriceTimeline } from "@/lib/purchaseStats";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import type { OutboxOperation, SupplierPriceHistory, SupplierProduct } from "@/types/db";
import { INPUT_CLASS } from "./styles";
import { AmountInput } from "@/components/ui/amount-input";
import { parseAmount } from "@/lib/money";

interface OfferFormValues {
  supplierId: string;
  productId: string;
  price: number | string;
  date: string;
}

interface OfferFormModalProps {
  // Pin one side of the pair: from a product's panel the supplier is picked,
  // from a supplier's card the product is picked. Both set = update.
  productId?: string;
  supplierId?: string;
  onClose: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// A back-dated price is pinned to midday local time; today's uses "now" so it
// sorts after anything already recorded today.
function recordedAtFor(date: string): string {
  return date === today() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString();
}

// The supplier's current price must always be its most recent price point --
// recomputed after adding (possibly back-dated) or deleting one. Returns the
// outbox entry to push, or null when nothing changed.
async function syncCurrentOffer(supplierId: string, productId: string, now: string): Promise<OutboxOperation | null> {
  const history = await db.supplier_price_history
    .where("product_id")
    .equals(productId)
    .filter((h) => h.supplier_id === supplierId)
    .toArray();
  const latest = history.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  if (!latest) return null;

  const current = await db.supplier_products
    .where("product_id")
    .equals(productId)
    .filter((o) => o.supplier_id === supplierId)
    .first();
  if (current?.price === latest.price) return null;

  const offer: SupplierProduct = current
    ? { ...current, price: latest.price, updated_at: now }
    : { id: crypto.randomUUID(), supplier_id: supplierId, product_id: productId, price: latest.price, updated_at: now };
  const entry = current
    ? makeOutboxEntry("generic_update", "supplier_products", { id: offer.id, price: offer.price })
    : makeOutboxEntry("generic_insert", "supplier_products", {
        id: offer.id,
        supplier_id: supplierId,
        product_id: productId,
        price: offer.price,
      });
  await db.supplier_products.put(offer);
  await recordOutbox(entry);
  return entry;
}

// A supplier's price for one product: record a new (optionally back-dated)
// price without losing the earlier ones, and see/clean up that history.
export function OfferFormModal({ productId, supplierId, onClose }: OfferFormModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const suppliers = useLiveQuery(() => db.suppliers.orderBy("name").toArray(), []);
  // products has no name index (lib/db.ts) -- sort in memory.
  const products = useLiveQuery(
    () => db.products.toArray().then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name))),
    [],
  );
  const existing = useLiveQuery(
    () =>
      productId && supplierId
        ? db.supplier_products.where("product_id").equals(productId).filter((o) => o.supplier_id === supplierId).first()
        : undefined,
    [productId, supplierId],
  );

  const formik = useFormik<OfferFormValues>({
    enableReinitialize: true,
    initialValues: { supplierId: supplierId ?? "", productId: productId ?? "", price: existing?.price ?? "", date: today() },
    validationSchema: Yup.object({
      supplierId: Yup.string().required(t("suppliers.errorSupplierRequired")),
      productId: Yup.string().required(t("suppliers.errorProductRequired")),
      price: numberSchema(t("suppliers.errorPriceInvalid"), { min: 0, decimals: MONEY_DECIMALS }),
      date: Yup.string()
        .required(t("suppliers.errorDateInvalid"))
        .test("not-future", t("suppliers.errorDateInvalid"), (value) => !value || value <= today()),
    }),
    onSubmit: async (values, helpers) => {
      const now = new Date().toISOString();
      const point: SupplierPriceHistory = {
        id: crypto.randomUUID(),
        supplier_id: values.supplierId,
        product_id: values.productId,
        price: parseAmount(values.price),
        source: "manual",
        recorded_at: recordedAtFor(values.date),
        updated_at: now,
      };
      const historyEntry = makeOutboxEntry("generic_insert", "supplier_price_history", {
        id: point.id,
        supplier_id: point.supplier_id,
        product_id: point.product_id,
        price: point.price,
        source: point.source,
        recorded_at: point.recorded_at,
      });

      let offerEntry: OutboxOperation | null = null;
      await db.transaction("rw", [db.supplier_price_history, db.supplier_products, db.sync_outbox], async () => {
        await db.supplier_price_history.put(point);
        await recordOutbox(historyEntry);
        offerEntry = await syncCurrentOffer(values.supplierId, values.productId, now);
      });
      // History first: the offer row is only a cache of its latest point.
      await pushOutbox(historyEntry);
      if (offerEntry) void pushOutbox(offerEntry);

      showToast("success", t("suppliers.offerSavedToast"));
      helpers.resetForm({ values: { ...values, date: today() } });
    },
  });

  const pairHistory = useLiveQuery(
    () =>
      formik.values.productId && formik.values.supplierId
        ? db.supplier_price_history.where("product_id").equals(formik.values.productId).toArray()
        : [],
    [formik.values.productId, formik.values.supplierId],
  );
  const timeline = useMemo(
    () =>
      pairHistory && formik.values.supplierId && formik.values.productId
        ? supplierPriceTimeline(pairHistory, formik.values.supplierId, formik.values.productId)
        : [],
    [pairHistory, formik.values.supplierId, formik.values.productId],
  );

  const handleDeletePoint = async (point: SupplierPriceHistory) => {
    const now = new Date().toISOString();
    const deleteEntry = makeOutboxEntry("generic_delete", "supplier_price_history", { id: point.id });
    let offerEntry: OutboxOperation | null = null;
    await db.transaction("rw", [db.supplier_price_history, db.supplier_products, db.sync_outbox], async () => {
      await db.supplier_price_history.delete(point.id);
      await recordOutbox(deleteEntry);
      offerEntry = await syncCurrentOffer(point.supplier_id, point.product_id, now);
    });
    await pushOutbox(deleteEntry);
    if (offerEntry) void pushOutbox(offerEntry);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{t("suppliers.offerTitle")}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground" aria-label={t("pos.pin.close")}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={formik.handleSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("suppliers.supplierLabel")}</span>
            <select
              name="supplierId"
              value={formik.values.supplierId}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              disabled={!!supplierId}
              className={INPUT_CLASS}
            >
              <option value="">{t("suppliers.choose")}</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <FieldError touched={formik.touched.supplierId} error={formik.errors.supplierId} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("suppliers.productLabel")}</span>
            <select
              name="productId"
              value={formik.values.productId}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              disabled={!!productId}
              className={INPUT_CLASS}
            >
              <option value="">{t("suppliers.choose")}</option>
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <FieldError touched={formik.touched.productId} error={formik.errors.productId} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("suppliers.offerPriceLabel")}</span>
              <AmountInput
                name="price"
                value={formik.values.price}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                className={INPUT_CLASS}
              />
              <FieldError touched={formik.touched.price} error={formik.errors.price} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("suppliers.priceDateLabel")}</span>
              <input
                type="date"
                name="date"
                max={today()}
                value={formik.values.date}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                className={INPUT_CLASS}
              />
              <FieldError touched={formik.touched.date} error={formik.errors.date} />
            </label>
          </div>

          <ButtonCustom variant="primary" isLoading={formik.isSubmitting} onClick={() => void formik.submitForm()}>
            <Save aria-hidden />
            {t("suppliers.saveNewPrice")}
          </ButtonCustom>
        </form>

        {formik.values.supplierId && formik.values.productId && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("suppliers.priceHistory")}</p>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">{t("suppliers.noPriceHistory")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {timeline.map(({ entry, changePct }, index) => (
                  <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                        {formatCurrency(entry.price)}
                        {index === 0 && <span className="badge-green">{t("suppliers.currentPrice")}</span>}
                        {changePct !== undefined && Math.abs(changePct) >= 0.05 && (
                          <span
                            className={`inline-flex items-center gap-0.5 text-xs font-normal ${
                              changePct > 0 ? "text-destructive" : "text-success"
                            }`}
                          >
                            {changePct > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
                            {Math.abs(changePct).toFixed(1)}%
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(entry.recorded_at).toLocaleDateString()} ·{" "}
                        {entry.source === "restock" ? t("suppliers.sourceRestock") : t("suppliers.sourceManual")}
                      </p>
                    </div>
                    {/* A restock point is a real purchase -- only hand-entered
                        prices can be removed (e.g. a typo). */}
                    {entry.source === "manual" && (
                      <button
                        type="button"
                        onClick={() => void handleDeletePoint(entry)}
                        className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-destructive"
                        aria-label={t("suppliers.deletePricePoint")}
                        title={t("suppliers.deletePricePoint")}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
