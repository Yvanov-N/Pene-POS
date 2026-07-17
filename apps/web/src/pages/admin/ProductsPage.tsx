import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { ProductFilters } from "@/components/pos/ProductFilters";
import type { Product } from "@/types/db";

type SortKey = "name" | "price" | "stock";
type SortDir = "asc" | "desc";

interface FormState {
  name: string;
  price: string;
  stock: string;
  category: string;
  barcode: string;
  emoji: string;
  image_url: string;
  expiry_date: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  price: "",
  stock: "",
  category: "",
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
    category: product.category ?? "",
    barcode: product.barcode ?? "",
    emoji: product.emoji ?? "",
    image_url: product.image_url ?? "",
    expiry_date: product.expiry_date?.slice(0, 10) ?? "",
  };
}

const NEUTRAL_BUTTON_CLASS =
  "rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent";

export function ProductsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

  // "name"/"price"/"stock" aren't part of the Dexie schema's index list (id,
  // barcode, category, expiry_date, updated_at only) -- orderBy() throws at
  // runtime for unindexed fields, so filtering/sorting happens in memory.
  const products = useLiveQuery(() => db.products.toArray(), []);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_VALUE);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const visibleProducts = useMemo(() => {
    if (!products) return undefined;
    const term = searchTerm.trim().toLowerCase();

    const filtered = products.filter((product) => {
      if (activeCategory !== ALL_CATEGORIES_VALUE && product.category !== activeCategory) return false;
      if (!term) return true;
      return product.name.toLowerCase().includes(term) || (product.barcode ?? "").toLowerCase().includes(term);
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [products, searchTerm, activeCategory, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const openCreateDrawer = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDrawerOpen(true);
  };

  const openEditDrawer = (product: Product) => {
    setEditingId(product.id);
    setForm(productToForm(product));
    setFormError(null);
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const price = Number(form.price);
    const stock = Number(form.stock);

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

    setFormError(null);
    setSaving(true);
    try {
      const product: Product = {
        id: editingId ?? crypto.randomUUID(),
        name,
        price,
        stock,
        category: form.category.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        emoji: form.emoji.trim() || undefined,
        image_url: form.image_url.trim() || undefined,
        expiry_date: form.expiry_date ? new Date(form.expiry_date).toISOString() : undefined,
        updated_at: new Date().toISOString(),
      };

      await db.products.put(product);
      await enqueueMutation(editingId ? "UPDATE" : "INSERT", "products", { ...product });
      void triggerManualSync();

      showToast(
        "success",
        t(editingId ? "admin.products.updateSuccessToast" : "admin.products.createSuccessToast", { name }),
      );
      setDrawerOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: Product) => {
    await db.products.delete(product.id);
    await enqueueMutation("DELETE", "products", { id: product.id });
    void triggerManualSync();
    showToast("success", t("admin.products.deleteSuccessToast", { name: product.name }));
  };

  return (
    <div className="mx-auto max-w-5xl p-4">
      <CardCustom
        title={t("admin.products.title")}
        header={
          <ButtonCustom variant="primary" size="sm" onClick={openCreateDrawer}>
            {t("admin.products.add")}
          </ButtonCustom>
        }
      >
        <ProductFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />

        <div className="mt-4">
          {visibleProducts === undefined ? (
            <p className="text-sm text-muted">{t("admin.products.loading")}</p>
          ) : visibleProducts.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.products.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3" />
                    <th className="cursor-pointer select-none py-2 pr-3" onClick={() => toggleSort("name")}>
                      {t("admin.products.fieldName")}
                      {sortIndicator("name")}
                    </th>
                    <th className="py-2 pr-3">{t("admin.products.fieldBarcode")}</th>
                    <th className="py-2 pr-3">{t("admin.products.fieldCategory")}</th>
                    <th className="cursor-pointer select-none py-2 pr-3" onClick={() => toggleSort("price")}>
                      {t("admin.products.fieldPrice")}
                      {sortIndicator("price")}
                    </th>
                    <th className="cursor-pointer select-none py-2 pr-3" onClick={() => toggleSort("stock")}>
                      {t("admin.products.fieldStock")}
                      {sortIndicator("stock")}
                    </th>
                    <th className="py-2 pr-3">{t("admin.products.fieldExpiry")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => (
                    <tr key={product.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        {product.image_url ? (
                          <img src={product.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                        ) : (
                          <span className="text-xl" aria-hidden>
                            {product.emoji || "📦"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-medium text-foreground">{product.name}</td>
                      <td className="py-2 pr-3 text-muted">{product.barcode ?? "—"}</td>
                      <td className="py-2 pr-3 text-muted">{product.category ?? "—"}</td>
                      <td className="py-2 pr-3 text-foreground">{formatCurrency(product.price)}</td>
                      <td className="py-2 pr-3 text-foreground">{product.stock}</td>
                      <td className="py-2 pr-3 text-muted">
                        {product.expiry_date ? new Date(product.expiry_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2">
                        <div className="flex justify-end gap-2">
                          <button type="button" className={NEUTRAL_BUTTON_CLASS} onClick={() => openEditDrawer(product)}>
                            {t("admin.products.edit")}
                          </button>
                          <ButtonCustom
                            variant="danger"
                            size="sm"
                            requiresAdminPin
                            pinModalTitle={t("admin.products.deletePinTitle")}
                            onClick={() => void handleDelete(product)}
                          >
                            {t("admin.products.delete")}
                          </ButtonCustom>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardCustom>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {editingId ? t("admin.products.editTitle") : t("admin.products.addTitle")}
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
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.products.fieldBarcode")}</span>
                <input
                  type="text"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
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
                  onClick={() => setDrawerOpen(false)}
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
      )}
    </div>
  );
}
