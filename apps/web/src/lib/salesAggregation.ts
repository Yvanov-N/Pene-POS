import { db } from "@/lib/db";
import type { Sale } from "@/types/db";

// A rejected MoMo sale keeps status completed/pending_sync (rejection is
// tracked separately via momo_verification_status) and a refunded sale
// already carries its own distinct "refunded" status -- both excluded here.
// Single source of truth: was duplicated identically in useDashboardAnalytics,
// StudentWalletsPage, and StudentProfileDrawer before this extraction.
export function isRevenueRelevant(sale: Sale): boolean {
  return (sale.status === "completed" || sale.status === "pending_sync") && sale.momo_verification_status !== "rejected";
}

export interface ProductTotals {
  quantitySold: number;
  revenue: number;
}

// Shared by useDashboardAnalytics' top-5-by-revenue widget (date-range-scoped
// saleIds) and ProductGrid's all-time best-seller sort (unbounded saleIds) --
// same per-product join+sum either way, just fed a different saleIds set.
export async function buildProductTotals(saleIds: string[]): Promise<Map<string, ProductTotals>> {
  const items = saleIds.length > 0 ? await db.sale_items.where("sale_id").anyOf(saleIds).toArray() : [];
  const totals = new Map<string, ProductTotals>();
  for (const item of items) {
    const bucket = totals.get(item.product_id) ?? { quantitySold: 0, revenue: 0 };
    bucket.quantitySold += item.quantity;
    bucket.revenue += item.quantity * item.unit_price;
    totals.set(item.product_id, bucket);
  }
  return totals;
}
