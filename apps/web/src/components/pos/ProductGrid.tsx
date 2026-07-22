import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { useNetworkFirstQuery } from "@/hooks/useNetworkFirstQuery";
import { getPendingIds, mapProductRow } from "@/services/syncService";
import type { Product } from "@/types/db";
import { formatCurrency } from "@/lib/currency";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 7;

interface ProductGridProps {
  searchTerm: string;
  category: string;
  onProductSelect: (product: Product) => void;
}

function getStockBadge(t: TFunction, stock: number): { label: string; className: string } | null {
  if (stock === 0) return { label: t("pos.grid.outOfStock"), className: "badge-red" };
  if (stock <= 3) return { label: t("pos.grid.lowStock"), className: "badge-amber" };
  return null;
}

function getExpiryLabel(t: TFunction, expiryDate?: string): string | null {
  if (!expiryDate) return null;
  const daysLeft = (new Date(expiryDate).getTime() - Date.now()) / DAY_MS;
  if (daysLeft < 0) return t("pos.grid.expired");
  if (daysLeft <= EXPIRY_WARNING_DAYS) return t("pos.grid.expiringSoon");
  return null;
}

function ProductVisual({ product }: { product: Product }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (product.image_url && !imageFailed) {
    return (
      <img
        src={product.image_url}
        alt={product.name}
        className="h-16 w-16 rounded-md object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className="text-4xl" aria-hidden>
      {product.emoji || "📦"}
    </span>
  );
}

export function ProductGrid({ searchTerm, category, onProductSelect }: ProductGridProps) {
  const { t } = useTranslation();
  // category_id is indexed (lib/db.ts v5) -- scope the Dexie read to the
  // selected category instead of pulling the full catalog on every render
  // when a category filter is active.
  //
  // Network-first: renders instantly from the Dexie cache below (unchanged
  // from before), while a direct Supabase fetch races in the background and
  // refreshes it -- the highest-value read to convert first, since stale
  // stock counts here are exactly what causes a cross-terminal oversell.
  const fetchRemote = useCallback(
    async (signal: AbortSignal) => {
      const query =
        category === ALL_CATEGORIES_VALUE
          ? supabase.from("products").select("*")
          : supabase.from("products").select("*").eq("category_id", category);
      const { data, error } = await query.abortSignal(signal);
      if (error) throw error;
      return data;
    },
    [category],
  );
  const writeBack = useCallback(async (rows: Awaited<ReturnType<typeof fetchRemote>>) => {
    // Never clobber a row with a still-unsynced local edit (e.g. a queued
    // restock) with a stale server value -- same guard pullFromSupabase uses.
    const pendingIds = await getPendingIds("product_id");
    const toPut = rows.filter((row) => !pendingIds.has(row.id)).map(mapProductRow);
    if (toPut.length > 0) await db.products.bulkPut(toPut);
  }, []);

  const products = useNetworkFirstQuery(
    () =>
      category === ALL_CATEGORIES_VALUE
        ? db.products.toArray()
        : db.products.where("category_id").equals(category).toArray(),
    [category],
    { fetchRemote, writeBack },
  );

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return products ?? [];
    return (products ?? []).filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.barcode ?? "").toLowerCase().includes(term),
    );
  }, [products, searchTerm]);

  if (products === undefined) {
    return <p className="p-4 text-sm text-muted">{t("pos.grid.loading")}</p>;
  }

  if (filtered.length === 0) {
    return <p className="p-4 text-sm text-muted">{t("pos.grid.empty")}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {filtered.map((product) => (
        <ProductCard key={product.id} product={product} onSelect={onProductSelect} />
      ))}
    </div>
  );
}

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

// Memoized so an unrelated ProductGrid re-render doesn't rebuild every
// visible card -- effective as long as onSelect stays referentially stable
// (it comes from useCartActions()'s useCallback-wrapped addItem).
const ProductCard = memo(function ProductCard({ product, onSelect }: ProductCardProps) {
  const { t } = useTranslation();
  const stockBadge = getStockBadge(t, product.stock);
  const expiryLabel = getExpiryLabel(t, product.expiry_date);

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      className={`flex flex-col items-center gap-2 rounded-lg border bg-surface2 p-3 text-center transition-colors hover:border-accent ${
        expiryLabel ? "border-destructive" : "border-border"
      }`}
    >
      <ProductVisual product={product} />
      <span className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</span>
      <span className="text-sm font-semibold text-foreground">{formatCurrency(product.price)}</span>
      <span className="text-xs text-muted">{t("pos.grid.stockLabel", { count: product.stock })}</span>
      <div className="flex flex-wrap justify-center gap-1">
        {stockBadge && <span className={stockBadge.className}>{stockBadge.label}</span>}
        {expiryLabel && <span className="badge-red">{expiryLabel}</span>}
      </div>
    </button>
  );
});
