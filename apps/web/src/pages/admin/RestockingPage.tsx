import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { TFunction } from "i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { submitGenericMutationNetworkFirst } from "@/services/repository";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
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

export function RestockingPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [expiryInput, setExpiryInput] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
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

  const selectProduct = (product: Product) => {
    setSelected(product);
    setQuantity(0);
    setExpiryInput(product.expiry_date?.slice(0, 10) ?? "");
    setNameSearch("");
  };

  const handleValidate = async () => {
    if (!selected || quantity <= 0) return;
    setSubmitting(true);
    try {
      const fresh = await db.products.get(selected.id);
      if (!fresh) {
        showToast("error", t("restocking.productGoneError"));
        setSelected(null);
        return;
      }

      const updated: Product = {
        ...fresh,
        stock: fresh.stock + quantity,
        expiry_date: expiryInput ? new Date(expiryInput).toISOString() : fresh.expiry_date,
        updated_at: new Date().toISOString(),
      };

      const mode = await submitGenericMutationNetworkFirst("UPDATE", "products", { ...updated });
      await db.products.put(updated);
      if (mode === "local") {
        await enqueueMutation("UPDATE", "products", { ...updated });
        void triggerManualSync();
        showToast("warning", t("sync.offlineFallbackToast"));
      }

      showToast("success", t("restocking.successToast", { name: updated.name, quantity }));
      setSelected(null);
      setQuantity(0);
      setExpiryInput("");
      // Ready for the next box immediately -- BarcodeInput itself only
      // refocuses on its own scan events, not on this page's own submit
      // action, so without this the manager would have to click back into
      // the field before the next scan is picked up as text input focus
      // (background keyboard-emulation detection still works either way,
      // but hardware HID/serial + the visual caret shouldn't require it).
      barcodeInputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
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
                      onClick={() => setQuantity((current) => current + amount)}
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
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(0, Math.floor(Number(e.target.value)) || 0))}
                  className="w-32 rounded-lg border border-border bg-surface2 px-3 py-2 text-lg font-semibold text-foreground"
                />
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("restocking.expiryLabel")}</span>
                <input
                  type="date"
                  value={expiryInput}
                  onChange={(e) => setExpiryInput(e.target.value)}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>

              <ButtonCustom
                variant="success"
                size="lg"
                disabled={quantity <= 0}
                isLoading={submitting}
                onClick={() => void handleValidate()}
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
