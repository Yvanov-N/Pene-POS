import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { mapProductRow, writeBackIfNewer } from "@/services/sync/pull";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { usePaginatedQuery, type PageParams, type PageResult } from "@/hooks/usePaginatedQuery";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { PaginationControls } from "@/components/admin/PaginationControls";
import { SortableTh } from "@/components/admin/SortableTh";
import { useTableSort } from "@/hooks/useTableSort";
import { sortRows, type SortDir } from "@/lib/sorting";
import { usePageSize } from "@/hooks/usePageSize";
import { ProductFilters } from "@/components/pos/ProductFilters";
import { ProductFormDrawer } from "@/components/admin/products/ProductFormDrawer";
import { CategoryManagerModal } from "@/components/admin/products/CategoryManagerModal";
import { ProductDetailDrawer } from "@/components/admin/products/ProductDetailDrawer";
import type { Product } from "@/types/db";
import { ProductThumb } from "@/components/ui/product-thumb";
import { Eye, Pencil, Plus, Tags, Trash2 } from "lucide-react";

type SortKey = "name" | "barcode" | "category" | "price" | "cost" | "margin" | "stock" | "expiry";

// Server .order() needs a real column; the two computed sorts fall back to a
// related one. Rows are always rendered from the local query (sorted exactly
// below), the server page only refreshes Dexie and the total count.
const SERVER_SORT_COLUMN: Record<SortKey, string> = {
  name: "name",
  barcode: "barcode",
  category: "category_id",
  price: "price",
  cost: "cost_price",
  margin: "price",
  stock: "stock",
  expiry: "expiry_date",
};

// First click on a column: text A->Z, amounts/stock highest first, expiry soonest first.
const FIRST_DIR: Partial<Record<SortKey, SortDir>> = { price: "desc", cost: "desc", margin: "desc", stock: "desc" };
interface ProductFilters_ {
  category: string;
}


const NEUTRAL_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent";

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

// Local fallback (offline, or the server attempt timed out/failed) -- the
// exact same filter/sort this page always did, just sliced to the requested
// page instead of rendering the whole table.
async function queryLocalProducts(params: PageParams<SortKey, ProductFilters_>): Promise<PageResult<Product>> {
  const [all, categories] = await Promise.all([db.products.toArray(), db.categories.toArray()]);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const term = params.searchTerm.trim().toLowerCase();

  const filtered = all.filter((product) => {
    if (params.filters.category !== ALL_CATEGORIES_VALUE && product.category_id !== params.filters.category) return false;
    if (!term) return true;
    return product.name.toLowerCase().includes(term) || (product.barcode ?? "").toLowerCase().includes(term);
  });

  const sortValue = (product: Product) => {
    switch (params.sortKey) {
      case "name":
        return product.name;
      case "barcode":
        return product.barcode;
      case "category":
        return product.category_id ? categoryNames.get(product.category_id) : undefined;
      case "price":
        return product.price;
      case "cost":
        return product.cost_price;
      case "margin":
        return product.cost_price === undefined ? undefined : product.price - product.cost_price;
      case "stock":
        return product.stock;
      case "expiry":
        return product.expiry_date;
    }
  };
  const sorted = sortRows(filtered, sortValue, params.sortDir);

  const offset = (params.page - 1) * params.pageSize;
  return { rows: sorted.slice(offset, offset + params.pageSize), totalCount: sorted.length };
}

// Server path -- .range()/.ilike()/.order()/count:"exact". sortKey ("name"|
// "price"|"stock") maps 1:1 to real column names, so .order(sortKey, ...) is
// safe (constrained union type, not a raw user string).
async function fetchServerProducts(
  params: PageParams<SortKey, ProductFilters_>,
  signal: AbortSignal,
): Promise<PageResult<Product>> {
  const offset = (params.page - 1) * params.pageSize;
  // deleted_at is null: soft-deleted products (migration 00023) must not
  // reappear in the admin list -- the tombstone row only exists so a
  // cursor-based pull can propagate the deletion to other devices, it was
  // never meant to be user-visible.
  let query = supabase.from("products").select("*", { count: "exact" }).is("deleted_at", null);
  if (params.filters.category !== ALL_CATEGORIES_VALUE) query = query.eq("category_id", params.filters.category);
  const term = params.searchTerm.trim().replace(/[%,()]/g, "");
  if (term) query = query.or(`name.ilike.%${term}%,barcode.ilike.%${term}%`);

  const { data, error, count } = await query
    .order(SERVER_SORT_COLUMN[params.sortKey], { ascending: params.sortDir === "asc" })
    .range(offset, offset + params.pageSize - 1)
    .abortSignal(signal);
  if (error) throw error;
  return { rows: data.map(mapProductRow), totalCount: count ?? 0 };
}

async function writeBackProducts(rows: Product[]): Promise<void> {
  // "Only accept if newer" (by sync_seq) -- same rule the main pull cycle
  // uses (services/sync/pull.ts), applied here too so a still-unsynced
  // local edit (e.g. a queued restock) can't be clobbered by a stale server
  // value from this page's own direct search fetch.
  await writeBackIfNewer(db.products, rows, (row) => row);
}

export function ProductsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { isOnline } = useSyncEngine();

  const categories = useLiveQuery(() => db.categories.toArray(), []);
  const categoryNameById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  );

  const [searchTerm, setSearchTermState] = useState("");
  const [activeCategory, setActiveCategoryState] = useState(ALL_CATEGORIES_VALUE);
  const [page, setPage] = useState(1);
  const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>("name", "asc", FIRST_DIR, () => setPage(1));
  const [pageSize, setPageSize] = usePageSize("products");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  // Changing a search/filter/sort while on page 3 could otherwise land on an
  // empty page -- every change resets back to page 1.
  const setSearchTerm = (value: string) => {
    setSearchTermState(value);
    setPage(1);
  };
  const setActiveCategory = (value: string) => {
    setActiveCategoryState(value);
    setPage(1);
  };

  const { rows: visibleProducts, totalCount, totalPages } = usePaginatedQuery({
    params: {
      page,
      pageSize,
      searchTerm,
      sortKey,
      sortDir,
      filters: { category: activeCategory },
    },
    queryLocal: queryLocalProducts,
    fetchServer: fetchServerProducts,
    writeBack: writeBackProducts,
  });

  const sortTh = (column: SortKey, label: string) => (
    <SortableTh column={column} label={label} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
  );

  const openCreateDrawer = () => {
    setEditingProduct(null);
    setDrawerOpen(true);
  };

  const openEditDrawer = (product: Product) => {
    setEditingProduct(product);
    setDrawerOpen(true);
  };

  const handleDelete = async (product: Product) => {
    // A deleted product is soft-deleted server-side now (deleted_at, not an
    // actual DELETE -- migration 00023), so the historical FK-RESTRICT
    // concern this guard originally existed for no longer technically
    // applies. Kept anyway as a deliberate business rule: a product with
    // real sale history stays out of the deletable set, not just avoiding a
    // sync conflict. A product still sitting in the shared active cart is
    // blocked for a real technical reason though -- cart_items would dangle
    // after PosCart looks up a product that no longer exists locally.
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

    const entry = makeOutboxEntry("generic_delete", "products", { id: product.id });
    await commitLocal(db.products, () => db.products.delete(product.id), entry);
    void pushOutbox(entry);
    showToast("success", t("admin.products.deleteSuccessToast"));
  };

  return (
    <div className="table-page">
      <CardCustom
        className="table-card"
        title={t("admin.products.title")}
        header={
          <div className="flex gap-2">
            <ButtonCustom variant="primary" size="sm" onClick={() => setCategoryManagerOpen(true)}>
              <Tags className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("admin.categories.manageButton")}
            </ButtonCustom>
            <ButtonCustom variant="primary" size="sm" onClick={openCreateDrawer}>
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
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

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          {visibleProducts === undefined ? (
            <p className="text-sm text-muted">{t("admin.products.loading")}</p>
          ) : visibleProducts.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.products.empty")}</p>
          ) : (
            <div className="table-scroll">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="w-12 py-2 pr-3" />
                    {sortTh("name", t("admin.products.fieldName"))}
                    {sortTh("barcode", t("admin.products.fieldBarcode"))}
                    {sortTh("category", t("admin.products.fieldCategory"))}
                    {sortTh("price", t("admin.products.fieldPrice"))}
                    {sortTh("cost", t("admin.products.columnCost"))}
                    {sortTh("margin", t("admin.products.columnMargin"))}
                    {sortTh("stock", t("admin.products.fieldStock"))}
                    {sortTh("expiry", t("admin.products.fieldExpiry"))}
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const lowStock = product.stock <= LOW_STOCK_THRESHOLD;
                    const expiring = isExpiringSoon(product.expiry_date);

                    return (
                      <tr
                        key={product.id}
                        onClick={() => setDetailProduct(product)}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-surface2"
                      >
                        <td className="w-12 py-2 pr-3">
                          <ProductThumb product={product} size="sm" />
                        </td>
                        <td className="py-2 pr-3 font-medium text-foreground">
                          <span
                            className="block max-w-[14rem] truncate whitespace-nowrap underline-offset-2 hover:underline"
                            title={product.name}
                          >
                            {product.name}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-muted">{product.barcode ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {product.category_id && categoryNameById.get(product.category_id) ? (
                            <span className="badge-blue">{categoryNameById.get(product.category_id)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3 text-foreground">{formatCurrency(product.price)}</td>
                        <td className="py-2 pr-3 text-muted">
                          {product.cost_price !== undefined ? formatCurrency(product.cost_price) : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {product.cost_price === undefined ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className={product.price - product.cost_price <= 0 ? "text-destructive" : "text-success"}>
                              {formatCurrency(product.price - product.cost_price)}
                              {product.price > 0 && (
                                <span className="text-xs text-muted">
                                  {" "}
                                  ({Math.round(((product.price - product.cost_price) / product.price) * 100)}%)
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {product.stock < 0 ? (
                            <span className="badge-red">{product.stock}</span>
                          ) : lowStock ? (
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
                        {/* Stops the row's "open details" click -- including clicks
                            inside the delete button's PIN modal, which renders here. */}
                        <td className="py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-2">
                            <button type="button" className={NEUTRAL_BUTTON_CLASS} onClick={() => setDetailProduct(product)}>
                              <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              {t("admin.products.details")}
                            </button>
                            <button type="button" className={NEUTRAL_BUTTON_CLASS} onClick={() => openEditDrawer(product)}>
                              <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              {t("admin.products.edit")}
                            </button>
                            <ButtonCustom
                              variant="danger"
                              size="sm"
                              requiresAdminPin
                              pinModalTitle={t("admin.products.deletePinTitle")}
                              onClick={() => void handleDelete(product)}
                            >
                              <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
          {visibleProducts !== undefined && totalCount > 0 && (
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
          )}
          {!isOnline && <p className="mt-2 text-xs text-muted">{t("admin.pagination.offlineNotice")}</p>}
        </div>
      </CardCustom>

      {drawerOpen && <ProductFormDrawer product={editingProduct} onClose={() => setDrawerOpen(false)} />}
      {detailProduct && <ProductDetailDrawer product={detailProduct} onClose={() => setDetailProduct(null)} />}
      {categoryManagerOpen && <CategoryManagerModal onClose={() => setCategoryManagerOpen(false)} />}
    </div>
  );
}
