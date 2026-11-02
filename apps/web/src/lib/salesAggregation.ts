import { db } from "@/lib/db";
import type { Sale, SaleItem } from "@/types/db";

// A rejected MoMo sale keeps status "completed" (rejection is tracked
// separately via momo_verification_status) and a refunded sale already
// carries its own distinct "refunded" status -- excluded here. Single source
// of truth: was duplicated identically in useDashboardAnalytics,
// StudentWalletsPage, and StudentProfileDrawer before this extraction.
//
// No "pending_sync" branch anymore -- every locally-committed sale is
// "completed" the instant it's created now (sync state moved out of this
// field entirely, see types/db.ts's Sale.status comment), so there's nothing
// left for that branch to match.
export function isRevenueRelevant(sale: Sale): boolean {
  return sale.status === "completed" && sale.momo_verification_status !== "rejected";
}

export interface ProductTotals {
  quantitySold: number;
  revenue: number;
  // Profit only counts lines whose purchase cost is known (sale_items.unit_cost,
  // migration 00036) -- a line sold before purchase prices were recorded is
  // left out rather than counted as 100% margin.
  costedRevenue: number;
  cost: number;
  profit: number;
  uncostedQuantity: number;
}

export function emptyProductTotals(): ProductTotals {
  return { quantitySold: 0, revenue: 0, costedRevenue: 0, cost: 0, profit: 0, uncostedQuantity: 0 };
}

export function addLineToTotals(totals: ProductTotals, item: Pick<SaleItem, "quantity" | "unit_price" | "unit_cost">): void {
  const lineRevenue = item.quantity * item.unit_price;
  totals.quantitySold += item.quantity;
  totals.revenue += lineRevenue;
  if (item.unit_cost === undefined || item.unit_cost === null) {
    totals.uncostedQuantity += item.quantity;
    return;
  }
  const lineCost = item.quantity * item.unit_cost;
  totals.costedRevenue += lineRevenue;
  totals.cost += lineCost;
  totals.profit += lineRevenue - lineCost;
}

// Pure part of buildProductTotals, per product id.
export function totalsByProduct(items: SaleItem[]): Map<string, ProductTotals> {
  const totals = new Map<string, ProductTotals>();
  for (const item of items) {
    const bucket = totals.get(item.product_id) ?? emptyProductTotals();
    addLineToTotals(bucket, item);
    totals.set(item.product_id, bucket);
  }
  return totals;
}

// Shared by useDashboardAnalytics' top-5-by-revenue widget (date-range-scoped
// saleIds) and ProductGrid's all-time best-seller sort (unbounded saleIds) --
// same per-product join+sum either way, just fed a different saleIds set.
export async function buildProductTotals(saleIds: string[]): Promise<Map<string, ProductTotals>> {
  const items = saleIds.length > 0 ? await db.sale_items.where("sale_id").anyOf(saleIds).toArray() : [];
  return totalsByProduct(items);
}
