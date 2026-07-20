import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { scannerService } from "@/services/hardware/scannerService";
import { ButtonCustom } from "@/components/ui/button-custom";
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
  const { triggerManualSync } = useSyncEngine();

  const [form, setForm] = useState<FormState>(product ? productToForm(product) : EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A second handleSave invocation landing before the first has re-rendered
  // (e.g. a fast double click) would read stale `saving` state -- state
  // updates aren't visible synchronously to a call already in flight. A ref
  // mutates immediately, so it's the only guard that actually closes that
  // window; without it, both calls could pass the async duplicate-barcode
  // check before either had written anything, and the second write would
  // then flag the first's own just-created row as a "duplicate".
  const savingRef = useRef(false);

  const categories = useLiveQuery(() => db.categories.orderBy("name").toArray(), []);

  // Safe to mount directly here (unlike StudentWalletRechargeCard's
  // window-event workaround from before routing existed): AppShell's routes
  // are mutually exclusive, so PosLayout's BarcodeInput (the app's other
  // useBarcodeScanner instance) is always unmounted while this drawer is
  // open on /admin/products.
  const { isConnected, connectionType, connectDevice } = useBarcodeScanner({
    onScan: (code) => setForm((current) => ({ ...current, barcode: code })),
  });
  const canPairScanner = scannerService.isHidSupported() || scannerService.isSerialSupported();
  const connectionLabel =
    connectionType === "hid"
      ? t("pos.barcode.connectedHid")
      : connectionType === "serial"
        ? t("pos.barcode.connectedSerial")
        : t("pos.barcode.keyboardMode");

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    try {
      const name = form.name.trim();
      const price = Number(form.price);
      const stock = Number(form.stock);
      const barcode = form.barcode.trim();

      if (!name) {
        setFormError(t("admin.products.errorNameRequired"));
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        setFormError(t("admin.products.errorPriceInvalid"));
        return;
      }
      if (!Number.isInteger(stock) || stock < 0) {
        setFormError(t("admin.products.errorStockInvalid"));
        return;
      }

      if (barcode) {
        const existing = await db.products.where("barcode").equals(barcode).first();
        if (existing && existing.id !== product?.id) {
          setFormError(t("admin.products.errorBarcodeDuplicate"));
          return;
        }
      }

      setFormError(null);
      const saved: Product = {
        id: product?.id ?? crypto.randomUUID(),
        name,
        price,
        stock,
        category_id: form.category_id || undefined,
        barcode: barcode || undefined,
        emoji: form.emoji.trim() || undefined,
        image_url: form.image_url.trim() || undefined,
        expiry_date: form.expiry_date ? new Date(form.expiry_date).toISOString() : undefined,
        updated_at: new Date().toISOString(),
      };

      await db.products.put(saved);
      await enqueueMutation(product ? "UPDATE" : "INSERT", "products", { ...saved });
      void triggerManualSync();

      showToast("success", t("admin.products.savedToast"));
      onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
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
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.products.fieldPrice")}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.products.fieldStock")}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.products.fieldCategory")}</span>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
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
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
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
                value={form.emoji}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-center text-foreground"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.products.fieldImageUrl")}</span>
              <input
                type="text"
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://..."
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.products.fieldExpiry")}</span>
            <input
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
          </label>

          {formError && <p className="text-xs text-destructive">{formError}</p>}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground disabled:opacity-50"
            >
              {t("admin.products.formCancel")}
            </button>
            <ButtonCustom variant="primary" className="flex-1" isLoading={saving} onClick={() => void handleSave()}>
              {t("admin.products.formSave")}
            </ButtonCustom>
          </div>
        </div>
      </div>
    </div>
  );
}
