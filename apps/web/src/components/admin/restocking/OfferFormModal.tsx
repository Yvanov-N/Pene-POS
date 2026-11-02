import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { db } from "@/lib/db";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { numberSchema } from "@/lib/validation";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import type { SupplierProduct } from "@/types/db";
import { INPUT_CLASS } from "./styles";

interface OfferFormValues {
  supplierId: string;
  productId: string;
  price: number | string;
}

interface OfferFormModalProps {
  // Pin one side of the pair: from a product's panel the supplier is picked,
  // from a supplier's card the product is picked. Both set = edit.
  productId?: string;
  supplierId?: string;
  onClose: () => void;
}

// A supplier's quoted price for one product (supplier_products). One row per
// supplier+product: saving an existing pair updates it instead of adding a
// duplicate the server's unique constraint would reject.
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
    initialValues: { supplierId: supplierId ?? "", productId: productId ?? "", price: existing?.price ?? "" },
    validationSchema: Yup.object({
      supplierId: Yup.string().required(t("suppliers.errorSupplierRequired")),
      productId: Yup.string().required(t("suppliers.errorProductRequired")),
      price: numberSchema(t("suppliers.errorPriceInvalid"), { min: 0 }),
    }),
    onSubmit: async (values) => {
      const price = Number(values.price);
      const now = new Date().toISOString();
      const current = await db.supplier_products
        .where("product_id")
        .equals(values.productId)
        .filter((o) => o.supplier_id === values.supplierId)
        .first();

      const offer: SupplierProduct = current
        ? { ...current, price, updated_at: now }
        : { id: crypto.randomUUID(), supplier_id: values.supplierId, product_id: values.productId, price, updated_at: now };
      const entry = current
        ? makeOutboxEntry("generic_update", "supplier_products", { id: offer.id, price })
        : makeOutboxEntry("generic_insert", "supplier_products", {
            id: offer.id,
            supplier_id: offer.supplier_id,
            product_id: offer.product_id,
            price,
          });
      await commitLocal(db.supplier_products, () => db.supplier_products.put(offer), entry);
      void pushOutbox(entry);

      showToast("success", t("suppliers.offerSavedToast"));
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
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

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("suppliers.offerPriceLabel")}</span>
            <input
              type="number"
              min="0"
              name="price"
              value={formik.values.price}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              className={INPUT_CLASS}
            />
            <FieldError touched={formik.touched.price} error={formik.errors.price} />
          </label>

          <ButtonCustom variant="primary" isLoading={formik.isSubmitting} onClick={() => void formik.submitForm()}>
            {t("suppliers.save")}
          </ButtonCustom>
        </form>
      </div>
    </div>
  );
}
