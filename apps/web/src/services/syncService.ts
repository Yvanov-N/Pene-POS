import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import type { Product, Sale, SaleItem, StudentWallet, SyncAction, SyncQueueItem } from "@/types/db";
import type { Database } from "@/types/supabase";

const MAX_RETRIES = 5;

// Postgres SQLSTATE for a check_violation -- the products_stock_non_negative
// / student_wallets_balance_non_negative constraints added in migration 2
// are what actually raise this, giving the push engine a real error to
// distinguish "oversold" from "something else went wrong".
const CHECK_VIOLATION_CODE = "23514";

type QueueOutcome = "completed" | "conflict";

interface SalePayload {
  sale: Sale;
  items: SaleItem[];
}

interface WalletRechargePayload {
  wallet_id: string;
  delta: number;
}

export async function enqueueMutation(
  action: SyncAction,
  tableName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.sync_queue.add({
    action,
    table_name: tableName,
    payload,
    created_at: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
  });
}

async function pushSale(payload: SalePayload): Promise<QueueOutcome> {
  const { sale, items } = payload;

  const { error: saleError } = await supabase.from("sales").insert(sale);
  if (saleError) throw saleError;

  const { error: itemsError } = await supabase.from("sale_items").insert(items);
  if (itemsError) throw itemsError;

  // Atomic RPC (migration 2) -- a fetch-then-subtract-then-write from the
  // client would race with a second terminal selling the same last item.
  for (const line of items) {
    const { error: stockError } = await supabase.rpc("decrement_product_stock", {
      p_product_id: line.product_id,
      p_quantity: line.quantity,
    });
    if (stockError) {
      if (stockError.code === CHECK_VIOLATION_CODE) return "conflict";
      throw stockError;
    }
  }

  await db.sales.update(sale.id, { status: "completed" });
  return "completed";
}

// Nothing in the app produces a WALLET_RECHARGE mutation yet (no recharge
// UI exists) -- implemented for the SyncAction contract's sake, untested
// live.
async function pushWalletRecharge(payload: WalletRechargePayload): Promise<QueueOutcome> {
  const { error } = await supabase.rpc("adjust_wallet_balance", {
    p_wallet_id: payload.wallet_id,
    p_delta: payload.delta,
  });
  if (error) {
    if (error.code === CHECK_VIOLATION_CODE) return "conflict";
    throw error;
  }
  return "completed";
}

// Generic fallback for plain INSERT/UPDATE/DELETE actions -- also currently
// unproduced, kept for forward compatibility with the SyncAction union.
async function pushGeneric(
  action: SyncAction,
  tableName: string,
  payload: Record<string, unknown>,
): Promise<QueueOutcome> {
  // tableName is an arbitrary runtime string, not a literal keyof
  // Database["public"]["Tables"] -- there's no static row shape to check
  // against here by design (this handler exists for actions/tables the
  // Database type doesn't know about yet).
  const table = supabase.from(tableName);
  const id = payload.id as string;

  const { error } =
    action === "INSERT"
      ? await table.insert(payload as never)
      : action === "UPDATE"
        ? await table.update(payload as never).eq("id", id)
        : await table.delete().eq("id", id);

  if (error) {
    if (error.code === CHECK_VIOLATION_CODE) return "conflict";
    throw error;
  }
  return "completed";
}

async function pushItem(item: SyncQueueItem): Promise<QueueOutcome> {
  switch (item.action) {
    case "SALE":
      return pushSale(item.payload as SalePayload);
    case "WALLET_RECHARGE":
      return pushWalletRecharge(item.payload as WalletRechargePayload);
    default:
      return pushGeneric(item.action, item.table_name, item.payload);
  }
}

export async function processSyncQueue(): Promise<void> {
  const candidates = await db.sync_queue.where("status").anyOf(["pending", "failed"]).toArray();

  for (const item of candidates) {
    if (item.id === undefined) continue;
    if (item.retryCount >= MAX_RETRIES) continue;

    try {
      const outcome = await pushItem(item);

      if (outcome === "conflict") {
        await db.sync_queue.update(item.id, { status: "conflict_warning" });
        if (item.action === "SALE") {
          const { sale } = item.payload as SalePayload;
          await db.sales.update(sale.id, { status: "conflict_warning" });
        }
      } else {
        await db.sync_queue.update(item.id, { status: "completed" });
      }
    } catch (error) {
      // One bad item must never stop the loop -- log and let it retry
      // next cycle, up to MAX_RETRIES.
      console.error("[syncService] failed to push queue item", item.id, error);
      await db.sync_queue.update(item.id, {
        status: "failed",
        retryCount: item.retryCount + 1,
      });
    }
  }
}

type PendingIdKind = "product_id" | "wallet_id";

async function getPendingIds(kind: PendingIdKind): Promise<Set<string>> {
  const pending = await db.sync_queue.where("status").anyOf(["pending", "failed"]).toArray();
  const ids = new Set<string>();

  for (const item of pending) {
    if (kind === "product_id" && item.action === "SALE") {
      const { items } = item.payload as SalePayload;
      for (const line of items) ids.add(line.product_id);
    } else if (kind === "wallet_id" && item.action === "WALLET_RECHARGE") {
      const { wallet_id } = item.payload as WalletRechargePayload;
      ids.add(wallet_id);
    }
  }

  return ids;
}

type SupabaseProductRow = Database["public"]["Tables"]["products"]["Row"];
type SupabaseWalletRow = Database["public"]["Tables"]["student_wallets"]["Row"];

export function mapProductRow(row: SupabaseProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    stock: row.stock,
    barcode: row.barcode ?? undefined,
    category: row.category ?? undefined,
    image_url: row.image_url ?? undefined,
    emoji: row.emoji ?? undefined,
    expiry_date: row.expiry_date ?? undefined,
    updated_at: row.updated_at,
  };
}

function mapWalletRow(row: SupabaseWalletRow): StudentWallet {
  return {
    id: row.id,
    student_name: row.student_name,
    badge_code: row.badge_code,
    balance: row.balance,
    email: row.email ?? "",
  };
}

// Pulls products/wallets/profiles down into Dexie without clobbering a
// local row that still has a pending/failed mutation queued against it --
// the server hasn't seen that change yet, so its version of that specific
// row is stale relative to ours.
export async function pullFromSupabase(): Promise<void> {
  const [pendingProductIds, pendingWalletIds] = await Promise.all([
    getPendingIds("product_id"),
    getPendingIds("wallet_id"),
  ]);

  const { data: products, error: productsError } = await supabase.from("products").select("*");
  if (productsError) {
    console.error("[syncService] failed to pull products", productsError);
  } else {
    const toUpsert = products.filter((row) => !pendingProductIds.has(row.id)).map(mapProductRow);
    if (toUpsert.length > 0) await db.products.bulkPut(toUpsert);
  }

  const { data: wallets, error: walletsError } = await supabase.from("student_wallets").select("*");
  if (walletsError) {
    console.error("[syncService] failed to pull student wallets", walletsError);
  } else {
    const toUpsert = wallets.filter((row) => !pendingWalletIds.has(row.id)).map(mapWalletRow);
    if (toUpsert.length > 0) await db.student_wallets.bulkPut(toUpsert);
  }

  // profiles: explicit column list only -- pin_code was never included in
  // the grant (migration 1), so a `select("*")` here would fail outright
  // with "permission denied for table profiles" (confirmed live in Phase 1.3).
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,email,full_name,role");
  if (profilesError) {
    console.error("[syncService] failed to pull profiles", profilesError);
  } else {
    for (const profile of profiles) {
      const existing = await db.profiles.get(profile.id);
      await db.profiles.put({
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        // Preserve any locally-set PIN hash; a brand-new pulled profile has
        // none yet and fails closed until a future PIN-assignment flow sets
        // one -- an empty string never matches a real SHA-256 digest.
        pin_hash: existing?.pin_hash ?? "",
      });
    }
  }
}
