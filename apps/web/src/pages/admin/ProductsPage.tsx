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
import { ProductFormDrawer } from "@/components/admin/products/ProductFormDrawer";
import { CategoryManagerModal } from "@/components/admin/products/CategoryManagerModal";
import type { Product } from "@/types/db";

type SortKey = "name" | "price" | "stock";
type SortDir = "asc" | "desc";

const NEUTRAL_BUTTON_CLASS =
  "rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent";

// Same thresholds as ProductGrid.tsx (POS grid) / OperationalWidgets.tsx
// (admin dashboard) -- one low-stock/expiry definition used consistently
// across the app, not a page-specific number.
const LOW_STOCK_THRESHOLD = 3;
const EXPIRY_WARNING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function isExpiringSoon(expiryDate?: string): boolean {
  if (!expiryDate) return false;
  const daysLeft = (new Date(expiryDate).getTime() - Date.now()) / DAY_MS;
  return daysLeft <= EXPIRY_WARNING_DAYS;
}

export function ProductsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

  // "name"/"price"/"stock" aren't part of the Dexie schema's index list (id,
  // barcode, category_id, expiry_date, updated_at only) -- orderBy() throws
  // at runtime for unindexed fields, so filtering/sorting happens in memory.
  const products = useLiveQuery(() => db.products.toArray(), []);
  const categories = useLiveQuery(() => db.categories.toArray(), []);
  const categoryNameById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_VALUE);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const visibleProducts = useMemo(() => {
    if (!products) return undefined;
    const term = searchTerm.trim().toLowerCase();

    const filtered = products.filter((product) => {
      if (activeCategory !== ALL_CATEGORIES_VALUE && product.category_id !== activeCategory) return false;
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
    setEditingProduct(null);
    setDrawerOpen(true);
  };

  const openEditDrawer = (product: Product) => {
    setEditingProduct(product);
    setDrawerOpen(true);
  };

  const handleDelete = async (product: Product) => {
    // The server rejects deleting a product referenced by historical
    // sale_items (no ON DELETE clause -> RESTRICT); checking locally first
    // gives a clear reason instead of a silent local delete that later sits
    // as an unresolved sync conflict (syncService already treats that FK
    // violation as "conflict", but the product would already look gone from
    // this device's own catalog by then). A product still sitting in the
    // shared active cart is blocked for the same reason: cart_items would
    // dangle after PosCart looks up a product that no longer exists.
    const [cartUsage, saleUsage] = await Promise.all([
      db.cart_items.where("product_id").equals(product.id).count(),
      db.sale_items.where("product_id").equals(product.id).count(),
    ]);

    if (cartUsage > 0) {
      showToast("error", t("admin.products.deleteBlockedInCart"));
      return;
    }
    if (saleUsage > 0) {
      showToast("error", t("admin.products.deleteBlockedHasSales"));
      return;
    }

    await db.products.delete(product.id);
    await enqueueMutation("DELETE", "products", { id: product.id });
    void triggerManualSync();
    showToast("success", t("admin.products.deleteSuccessToast"));
  };

  return (
    <div className="mx-auto max-w-5xl p-4">
      <CardCustom
        title={t("admin.products.title")}
        header={
          <div className="flex gap-2">
            <ButtonCustom variant="primary" size="sm" onClick={() => setCategoryManagerOpen(true)}>
              {t("admin.categories.manageButton")}
            </ButtonCustom>
            <ButtonCustom variant="primary" size="sm" onClick={openCreateDrawer}>
              {t("admin.products.add")}
            </ButtonCustom>
          </div>
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
              <table className="w-full min-w-[760px] border-collapse text-sm">
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
                  {visibleProducts.map((product) => {
                    const lowStock = product.stock <= LOW_STOCK_THRESHOLD;
                    const expiring = isExpiringSoon(product.expiry_date);

                    return (
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
                        <td className="py-2 pr-3">
                          {product.category_id && categoryNameById.get(product.category_id) ? (
                            <span className="badge-blue">{categoryNameById.get(product.category_id)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3 text-foreground">{formatCurrency(product.price)}</td>
                        <td className="py-2 pr-3">
                          {lowStock ? (
                            <span className="badge-amber">{product.stock}</span>
                          ) : (
                            <span className="text-foreground">{product.stock}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {product.expiry_date ? (
                            expiring ? (
                              <span className="badge-red">{new Date(product.expiry_date).toLocaleDateString()}</span>
                            ) : (
                              <span className="text-muted">{new Date(product.expiry_date).toLocaleDateString()}</span>
                            )
                          ) : (
                            "—"
                          )}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardCustom>

      {drawerOpen && <ProductFormDrawer product={editingProduct} onClose={() => setDrawerOpen(false)} />}
      {categoryManagerOpen && <CategoryManagerModal onClose={() => setCategoryManagerOpen(false)} />}
    </div>
  );
}
