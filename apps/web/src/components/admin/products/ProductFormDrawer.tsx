import { useRef, useState, type ChangeEvent } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { scannerService } from "@/services/hardware/scannerService";
import { notTakenByOther, numberSchema } from "@/lib/validation";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import type { Product } from "@/types/db";

interface FormState {
  name: string;
  price: string;
  stock: string;
  category_id: string;
  barcode: string;
  emoji: string;
  image_url: string;
  expiry_date: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  price: "",
  stock: "",
  category_id: "",
  barcode: "",
  emoji: "",
  image_url: "",
  expiry_date: "",
};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function productToForm(product: Product): FormState {
  return {
    name: product.name,
    price: String(product.price),
    stock: String(product.stock),
    category_id: product.category_id ?? "",
    barcode: product.barcode ?? "",
    emoji: product.emoji ?? "",
    image_url: product.image_url ?? "",
    expiry_date: product.expiry_date?.slice(0, 10) ?? "",
  };
}

interface ProductFormDrawerProps {
  // null = create mode, a Product = editing that row.
  product: Product | null;
  onClose: () => void;
}

export function ProductFormDrawer({ product, onClose }: ProductFormDrawerProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  // Generated upfront (not only at save time, unlike the rest of `saved` in
  // onSubmit below) so an image can be uploaded to a real storage path
  // before Save is ever clicked.
  const [productId] = useState(() => product?.id ?? crypto.randomUUID());
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const categories = useLiveQuery(() => db.categories.orderBy("name").toArray(), []);

  const formik = useFormik<FormState>({
    initialValues: product ? productToForm(product) : EMPTY_FORM,
    validateOnChange: false,
    validateOnBlur: true,
    validationSchema: Yup.object({
      name: Yup.string().trim().required(t("admin.products.errorNameRequired")),
      price: numberSchema(t("admin.products.errorPriceInvalid"), { min: 0 }),
      stock: numberSchema(t("admin.products.errorStockInvalid"), { min: 0, integer: true }),
      category_id: Yup.string(),
      barcode: Yup.string().test(
        "unique-barcode",
        t("admin.products.errorBarcodeDuplicate"),
        async (value) => {
          const trimmed = value?.trim();
          if (!trimmed) return true;
          const existing = await db.products.where("barcode").equals(trimmed).first();
          return notTakenByOther(existing, product?.id);
        },
      ),
      emoji: Yup.string(),
      image_url: Yup.string(),
      expiry_date: Yup.string(),
    }),
    onSubmit: async (values) => {
      const name = values.name.trim();
      const price = Number(values.price);
      const stock = Number(values.stock);
      const barcode = values.barcode.trim();

      const saved: Product = {
        id: productId,
        name,
        price,
        stock,
        category_id: values.category_id || undefined,
        barcode: barcode || undefined,
        emoji: values.emoji.trim() || undefined,
        image_url: values.image_url.trim() || undefined,
        expiry_date: values.expiry_date ? new Date(values.expiry_date).toISOString() : undefined,
        updated_at: new Date().toISOString(),
      };

      const entry = makeOutboxEntry(product ? "generic_update" : "generic_insert", "products", { ...saved });
      await commitLocal(db.products, () => db.products.put(saved), entry);
      void pushOutbox(entry);

      showToast("success", t("admin.products.savedToast"));
      onClose();
    },
  });

  // Safe to mount directly here (unlike StudentWalletRechargeCard's
  // window-event workaround from before routing existed): AppShell's routes
  // are mutually exclusive, so PosLayout's BarcodeInput (the app's other
  // useBarcodeScanner instance) is always unmounted while this drawer is
  // open on /admin/products.
  const { isConnected, connectionType, connectDevice } = useBarcodeScanner({
    onScan: (code) => formik.setFieldValue("barcode", code),
  });
  const canPairScanner = scannerService.isHidSupported() || scannerService.isSerialSupported();
  const connectionLabel =
    connectionType === "hid"
      ? t("pos.barcode.connectedHid")
      : connectionType === "serial"
        ? t("pos.barcode.connectedSerial")
        : t("pos.barcode.keyboardMode");

  const handleImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the exact same file later
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setImageError(t("admin.products.imageTypeError"));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t("admin.products.imageSizeError"));
      return;
    }

    setImageError(null);
    setImageUploading(true);
    try {
      const path = productId;
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      // Cache-bust: the path never changes across re-uploads, so without
      // this the browser would keep showing whatever it first cached here.
      void formik.setFieldValue("image_url", `${data.publicUrl}?v=${Date.now()}`);
    } catch (uploadError) {
      console.warn("[ProductFormDrawer] image upload failed", uploadError);
      setImageError(t("admin.products.imageUploadError"));
    } finally {
      setImageUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          {product ? t("admin.products.editTitle") : t("admin.products.addTitle")}
        </h2>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.products.fieldName")}</span>
            <input
              type="text"
              name="name"
              value={formik.values.name}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
            <FieldError touched={formik.touched.name} error={formik.errors.name} />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.products.fieldPrice")}</span>
              <input
                type="number"
                min="0"
                step="1"
                name="price"
                value={formik.values.price}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              <FieldError touched={formik.touched.price} error={formik.errors.price} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.products.fieldStock")}</span>
              <input
                type="number"
                min="0"
                step="1"
                name="stock"
                value={formik.values.stock}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              <FieldError touched={formik.touched.stock} error={formik.errors.stock} />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.products.fieldCategory")}</span>
            <select
              name="category_id"
              value={formik.values.category_id}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            >
              <option value="">{t("admin.products.categoryNone")}</option>
              {(categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.products.fieldBarcode")}</span>
            <div className="flex gap-2">
              <input
                type="text"
                name="barcode"
                value={formik.values.barcode}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              {canPairScanner && (
                <button
                  type="button"
                  onClick={() => void connectDevice()}
                  className="shrink-0 rounded-lg border border-border bg-surface2 px-3 py-2 text-xs font-medium text-foreground hover:border-accent"
                >
                  {t("admin.products.scanBarcode")}
                </button>
              )}
            </div>
            <FieldError touched={formik.touched.barcode} error={formik.errors.barcode} />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-success" : "bg-muted"}`} aria-hidden />
              {connectionLabel}
            </span>
          </label>

          <div className="flex gap-3">
            <label className="flex w-20 flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.products.fieldEmoji")}</span>
              <input
                type="text"
                name="emoji"
                value={formik.values.emoji}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-center text-foreground"
              />
            </label>
            <div className="flex flex-1 flex-col gap-2 text-sm">
              <span className="text-muted">{t("admin.products.fieldImageUrl")}</span>
              <div className="flex items-center gap-3">
                {formik.values.image_url && (
                  <img src={formik.values.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleImageSelected(e)}
                />
                <ButtonCustom
                  variant="primary"
                  size="sm"
                  isLoading={imageUploading}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {t("admin.products.imageImportButton")}
                </ButtonCustom>
              </div>
              {imageError && <p className="text-xs text-destructive">{imageError}</p>}

              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="h-px flex-1 bg-border" aria-hidden />
                {t("admin.products.imageOr")}
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>

              <input
                type="text"
                name="image_url"
                value={formik.values.image_url}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder="https://..."
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.products.fieldExpiry")}</span>
            <input
              type="date"
              name="expiry_date"
              value={formik.values.expiry_date}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
          </label>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={formik.isSubmitting}
              className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground disabled:opacity-50"
            >
              {t("admin.products.formCancel")}
            </button>
            <ButtonCustom
              variant="primary"
              className="flex-1"
              isLoading={formik.isSubmitting}
              onClick={() => void formik.submitForm()}
            >
              {t("admin.products.formSave")}
            </ButtonCustom>
          </div>
        </div>
      </div>
    </div>
  );
}
