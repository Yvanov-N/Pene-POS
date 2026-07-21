import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { enqueueMutation, mapProductRow, MAX_RETRIES } from "@/services/syncService";
import type { Sale, SyncQueueItem } from "@/types/db";

export interface ConflictLine {
  productId: string;
  productName: string;
  quantity: number;
  serverStock: number;
  wouldBeStock: number;
}

export interface ConflictDetail {
  sale: Sale;
  queueItemId?: number;
  lines: ConflictLine[];
}

async function findQueueItemForSale(saleId: string) {
  const queueItems = await db.sync_queue.where("status").equals("conflict_warning").toArray();
  return queueItems.find((item) => {
    if (item.action !== "SALE") return false;
    return item.payload.sale.id === saleId;
  });
}

async function findConflictSalesForProduct(productId: string): Promise<Sale[]> {
  const conflictSales = await db.sales.where("status").equals("conflict_warning").toArray();
  const matches: Sale[] = [];

  for (const sale of conflictSales) {
    const items = await db.sale_items.where("sale_id").equals(sale.id).toArray();
    if (items.some((item) => item.product_id === productId)) {
      matches.push(sale);
    }
  }

  return matches;
}

async function markResolved(sale: Sale, queueItemId?: number): Promise<void> {
  await db.sales.update(sale.id, { status: "completed" });
  if (queueItemId !== undefined) {
    await db.sync_queue.update(queueItemId, { status: "completed" });
  }
}

// Not one of the three named resolution methods, but the dashboard needs a
// clear, human-readable list to show -- this assembles it, including a live
// server-stock read (local data alone can't say what the real deficit is,
// since a conflicted product's local stock is just the optimistic
// post-checkout value, never reconciled).
export async function listConflicts(): Promise<ConflictDetail[]> {
  const conflictSales = await db.sales.where("status").equals("conflict_warning").toArray();
  if (conflictSales.length === 0) return [];

  const saleItemsBySale = new Map<string, { product_id: string; quantity: number }[]>();
  const allProductIds = new Set<string>();

  for (const sale of conflictSales) {
    const items = await db.sale_items.where("sale_id").equals(sale.id).toArray();
    saleItemsBySale.set(sale.id, items);
    for (const item of items) allProductIds.add(item.product_id);
  }

  const { data: serverProducts, error } = await supabase
    .from("products")
    .select("id,stock")
    .in("id", Array.from(allProductIds));
  if (error) {
    console.error("[conflictResolver] failed to fetch live stock", error);
  }
  const serverStockById = new Map((serverProducts ?? []).map((row) => [row.id, row.stock]));

  const details: ConflictDetail[] = [];

  for (const sale of conflictSales) {
    const items = saleItemsBySale.get(sale.id) ?? [];
    const queueItem = await findQueueItemForSale(sale.id);
    const lines: ConflictLine[] = [];

    for (const item of items) {
      const product = await db.products.get(item.product_id);
      const serverStock = serverStockById.get(item.product_id) ?? product?.stock ?? 0;
      lines.push({
        productId: item.product_id,
        productName: product?.name ?? item.product_id,
        quantity: item.quantity,
        serverStock,
        wouldBeStock: serverStock - item.quantity,
      });
    }

    details.push({ sale, queueItemId: queueItem?.id, lines });
  }

  return details;
}

export async function resolveByAdjustingStock(productId: string, newStockLevel: number): Promise<void> {
  await db.products.update(productId, { stock: newStockLevel });

  const affectedSales = await findConflictSalesForProduct(productId);
  for (const sale of affectedSales) {
    const queueItem = await findQueueItemForSale(sale.id);
    await markResolved(sale, queueItem?.id);
  }

  await enqueueMutation("UPDATE", "products", { id: productId, stock: newStockLevel });
}

export async function resolveByAcceptingNegativeStock(productId: string, saleId: string): Promise<void> {
  const sale = await db.sales.get(saleId);
  if (!sale) return;

  const queueItem = await findQueueItemForSale(saleId);
  await markResolved(sale, queueItem?.id);

  // Reconcile local stock against the current server truth for this one
  // product -- the oversold units are absorbed as unaccounted shrinkage
  // until a physical recount; this just stops local/server from drifting
  // further apart.
  const { data, error } = await supabase.from("products").select("*").eq("id", productId).single();
  if (!error && data) {
    await db.products.put(mapProductRow(data));
  }
}

export async function dismissConflict(queueItemId: number): Promise<void> {
  const queueItem = await db.sync_queue.get(queueItemId);
  if (!queueItem) return;

  await db.sync_queue.update(queueItemId, { status: "completed" });

  if (queueItem.action === "SALE") {
    await db.sales.update(queueItem.payload.sale.id, { status: "completed" });
  }
}

// Everything above this point (listConflicts/resolveByAdjustingStock/
// resolveByAcceptingNegativeStock) is SALE-specific: a stock oversell is the
// one conflict shape with a real, product-aware resolution UI. Any other
// mutation (a wallet recharge/withdrawal hitting adjust_wallet_balance's
// insufficient-balance guard, a generic UPDATE hitting a unique/FK
// violation) can *also* land in sync_queue as 'conflict_warning', or get
// stuck 'failed' after exhausting its retry budget -- and until now nothing
// in the app ever surfaced those. dismissConflict above already works for
// any table (only the SALE branch is sales-specific), it just never had
// callers for non-SALE items -- these two do.
export interface StuckSyncItem {
  id: number;
  tableName: string;
  action: string;
  status: "conflict_warning" | "failed";
  retryCount: number;
  errorMessage?: string;
  createdAt: string;
}

export async function listOtherStuckItems(): Promise<StuckSyncItem[]> {
  const all = await db.sync_queue.toArray();
  return all
    .filter((item): item is SyncQueueItem & { id: number } => {
      if (item.id === undefined) return false;
      // A genuine SALE conflict (stock oversell / deleted product) is
      // already surfaced via listConflicts() above, which reads
      // db.sales.status directly -- excluded here so the same stuck sale
      // doesn't get double-listed across both dashboard sections. A SALE
      // item stuck at "failed" (retries exhausted for a non-conflict
      // reason -- e.g. the old duplicate-key retry loop this file's own
      // migration note describes) has no other visible surface anywhere
      // else in the app, so it must NOT be excluded here.
      if (item.status === "conflict_warning") return item.action !== "SALE";
      return item.status === "failed" && item.retryCount >= (item.maxRetries ?? MAX_RETRIES);
    })
    .map((item) => ({
      id: item.id,
      tableName: item.table_name,
      action: item.action,
      status: item.status as "conflict_warning" | "failed",
      retryCount: item.retryCount,
      errorMessage: item.errorMessage,
      createdAt: item.created_at,
    }));
}

// Gives a transient failure another chance (a real Supabase hiccup, not a
// structural conflict) -- resets to 'pending' so the next sync cycle
// attempts it fresh, same retry budget as any other item from here.
export async function retryStuckItem(queueItemId: number): Promise<void> {
  await db.sync_queue.update(queueItemId, { status: "pending", retryCount: 0, errorMessage: undefined });
}
