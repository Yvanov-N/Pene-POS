import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import type {
  Category,
  Product,
  Sale,
  SaleItem,
  ShopStatus,
  StudentWallet,
  SyncAction,
  SyncQueueItem,
} from "@/types/db";
import type { Database } from "@/types/supabase";

// ============================================================================
// Offline-first repository pattern -- the one way any feature in this app
// reads and writes data. A future module (new table, new action) follows the
// same 3 steps every existing one already does:
//   1. Add the table to Dexie's schema (lib/db.ts) -- bump the version only
//      if you're adding/removing an INDEX, not for a plain new field.
//   2. Read exclusively via useLiveQuery(() => db.<table>...., []) in
//      components/hooks. Never a direct supabase.from(...).select(...) to
//      render UI -- the local table is the single source of truth for reads,
//      online or offline, so the UI never waits on a network round trip.
//   3. Write locally first (db.<table>.put/update/delete), then call
//      enqueueMutation(action, tableName, payload) (or the useOfflineMutation
//      hook, which just wraps that + triggerManualSync() in one call) and
//      void triggerManualSync(). Never await a direct supabase.from(...)
//      .insert/update/delete(...) from a click handler or form submit --
//      grep this file's own pushGeneric()/pushItem() before adding a new
//      action type; the odds are the generic INSERT/UPDATE/DELETE path
//      already handles a plain new table with zero new sync code.
//
// The few deliberate exceptions to step 3 in this codebase (documented at
// each call site, not silently done): supabase.auth.* calls (sign in/out,
// password/email change, OAuth linking) -- there's no local cache of an auth
// session to optimistically mutate, and these are rare, deliberate admin
// actions rather than the high-frequency POS transactional loop this engine
// exists to protect; Supabase Storage avatar uploads -- file bytes have no
// local-Dexie-mirror equivalent; and conflictResolver.ts's direct reads,
// which exist specifically to show an admin the live server truth while
// resolving a conflict, the one case where "read from network" is correct.
// ============================================================================

export const MAX_RETRIES = 5;

// Postgres SQLSTATE for a check_violation -- the products_stock_non_negative
// / student_wallets_balance_non_negative constraints added in migration 2
// are what actually raise this, giving the push engine a real error to
// distinguish "oversold" from "something else went wrong".
const CHECK_VIOLATION_CODE = "23514";

// Postgres SQLSTATE for a foreign_key_violation -- deleting a product that's
// referenced by historical sale_items (no ON DELETE clause -> RESTRICT) hits
// this. Treated the same as a check violation: surfaced as a "conflict"
// (stops retrying) instead of silently retrying MAX_RETRIES times and then
// giving up with no visible trace.
const FOREIGN_KEY_VIOLATION_CODE = "23503";

// Postgres SQLSTATE for a unique_violation -- e.g. two offline devices both
// creating a student wallet with the same badge_code before either has synced.
// The client already checks this locally before enqueueing, but a second
// device can't see the first device's still-unsynced row, so this is the
// real backstop. Same "conflict, don't infinite-retry" treatment.
const UNIQUE_VIOLATION_CODE = "23505";

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

// Shared by WALLET_RECHARGE (admin top-up, refund credit-back, wallet-payment
// checkout debit via a negative delta) and WALLET_WITHDRAWAL (student cash
// withdrawal, also a negative delta) -- both are the exact same server-side
// operation, just enqueued under a different action label so the dashboard
// can eventually tell "money the shop added/reversed" apart from "cash the
// shop physically paid out", something totalWalletRecharges' own comment
// already flags as impossible to distinguish today for WALLET_RECHARGE alone.
async function pushWalletBalanceAdjustment(payload: WalletRechargePayload): Promise<QueueOutcome> {
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

// Generic handler for plain INSERT/UPDATE/DELETE actions -- this is the path
// any new table/feature gets for free with zero new sync code (see the
// repository-pattern note at the top of this file): categories, products,
// student_wallets, profiles, and shop_status admin CRUD all go through here.
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
    if (
      error.code === CHECK_VIOLATION_CODE ||
      error.code === FOREIGN_KEY_VIOLATION_CODE ||
      error.code === UNIQUE_VIOLATION_CODE
    ) {
      return "conflict";
    }
    throw error;
  }
  return "completed";
}

async function pushItem(item: SyncQueueItem): Promise<QueueOutcome> {
  switch (item.action) {
    case "SALE":
      return pushSale(item.payload as SalePayload);
    case "WALLET_RECHARGE":
    case "WALLET_WITHDRAWAL":
      return pushWalletBalanceAdjustment(item.payload as WalletRechargePayload);
    default:
      return pushGeneric(item.action, item.table_name, item.payload);
  }
}

export interface SyncQueueSummary {
  completedSales: number;
  conflicts: number;
}

export async function processSyncQueue(): Promise<SyncQueueSummary> {
  const candidates = await db.sync_queue.where("status").anyOf(["pending", "failed"]).toArray();
  let completedSales = 0;
  let conflicts = 0;

  for (const item of candidates) {
    if (item.id === undefined) continue;
    if (item.retryCount >= (item.maxRetries ?? MAX_RETRIES)) continue;

    try {
      const outcome = await pushItem(item);

      if (outcome === "conflict") {
        await db.sync_queue.update(item.id, { status: "conflict_warning", errorMessage: undefined });
        if (item.action === "SALE") {
          const { sale } = item.payload as SalePayload;
          await db.sales.update(sale.id, { status: "conflict_warning" });
        }
        conflicts += 1;
      } else {
        await db.sync_queue.update(item.id, { status: "completed", errorMessage: undefined });
        if (item.action === "SALE") completedSales += 1;
      }
    } catch (error) {
      // One bad item must never stop the loop -- log and let it retry
      // next cycle, up to max_retries. The message is also stored on the
      // item itself (not just console.error, which nobody but a developer
      // ever sees) so the sync badge's error state and a future admin-facing
      // queue inspector can surface *why* something is stuck.
      console.error("[syncService] failed to push queue item", item.id, error);
      await db.sync_queue.update(item.id, {
        status: "failed",
        retryCount: item.retryCount + 1,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { completedSales, conflicts };
}

type PendingIdKind = "product_id" | "wallet_id" | "category_id" | "sale_id" | "profile_id" | "shop_status_id";

const PENDING_ID_TABLE: Record<PendingIdKind, string> = {
  product_id: "products",
  wallet_id: "student_wallets",
  category_id: "categories",
  sale_id: "sales",
  profile_id: "profiles",
  shop_status_id: "shop_status",
};

async function getPendingIds(kind: PendingIdKind): Promise<Set<string>> {
  const pending = await db.sync_queue.where("status").anyOf(["pending", "failed"]).toArray();
  const ids = new Set<string>();

  for (const item of pending) {
    if (kind === "product_id" && item.action === "SALE") {
      const { items } = item.payload as SalePayload;
      for (const line of items) ids.add(line.product_id);
    } else if (kind === "sale_id" && item.action === "SALE") {
      const { sale } = item.payload as SalePayload;
      ids.add(sale.id);
    } else if (
      kind === "wallet_id" &&
      (item.action === "WALLET_RECHARGE" || item.action === "WALLET_WITHDRAWAL")
    ) {
      const { wallet_id } = item.payload as WalletRechargePayload;
      ids.add(wallet_id);
    } else if (
      (item.action === "INSERT" || item.action === "UPDATE" || item.action === "DELETE") &&
      item.table_name === PENDING_ID_TABLE[kind]
    ) {
      // The generic INSERT/UPDATE/DELETE path (products/student_wallets admin
      // CRUD, shop_status) was previously unused -- SALE/WALLET_RECHARGE were
      // the only producers this protection accounted for. Without this
      // branch, a still-retrying product/wallet/shop_status edit would get
      // silently overwritten by the very next pull, right after the push
      // that's supposed to persist it.
      //
      // String(id): shop_status's payload id is a real number (1, its fixed
      // primary key), not a uuid string like every other table here -- both
      // need to land in the same Set<string> so `.has()` lookups against it
      // work regardless of which shape produced the entry.
      const id = (item.payload as { id?: string | number }).id;
      if (id !== undefined) ids.add(String(id));
    }
  }

  return ids;
}

// Deletes any not-yet-pushed SALE queue entry for a given sale -- used when
// a sale gets voided/rejected before it ever reached Supabase, so the
// original (now-superseded) push never fires and re-decrements server-side
// stock after the caller has already restored it locally. Shared by
// MoMoVerificationCard's reject flow and refundService's voidSale.
export async function cancelPendingSalePush(saleId: string): Promise<void> {
  const queueItems = await db.sync_queue.toArray();
  for (const item of queueItems) {
    if (
      item.action === "SALE" &&
      (item.payload as { sale?: Sale }).sale?.id === saleId &&
      item.id !== undefined
    ) {
      await db.sync_queue.delete(item.id);
    }
  }
}

type SupabaseProductRow = Database["public"]["Tables"]["products"]["Row"];
type SupabaseWalletRow = Database["public"]["Tables"]["student_wallets"]["Row"];
type SupabaseCategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type SupabaseSaleRow = Database["public"]["Tables"]["sales"]["Row"];
type SupabaseSaleItemRow = Database["public"]["Tables"]["sale_items"]["Row"];
type SupabaseShopStatusRow = Database["public"]["Tables"]["shop_status"]["Row"];

export function mapProductRow(row: SupabaseProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    stock: row.stock,
    barcode: row.barcode ?? undefined,
    category_id: row.category_id ?? undefined,
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
    email_opt_in: row.email_opt_in,
  };
}

function mapCategoryRow(row: SupabaseCategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    updated_at: row.updated_at,
  };
}

function mapSaleRow(row: SupabaseSaleRow): Sale {
  return {
    id: row.id,
    created_at: row.created_at,
    cashier_id: row.cashier_id,
    total_amount: row.total_amount,
    payment_method: row.payment_method,
    student_id: row.student_id ?? undefined,
    status: row.status,
    momo_verification_status: row.momo_verification_status ?? undefined,
  };
}

function mapSaleItemRow(row: SupabaseSaleItemRow): SaleItem {
  return {
    id: row.id,
    sale_id: row.sale_id,
    product_id: row.product_id,
    quantity: row.quantity,
    unit_price: row.unit_price,
  };
}

function mapShopStatusRow(row: SupabaseShopStatusRow): ShopStatus {
  return {
    id: row.id,
    is_open: row.is_open,
    updated_at: row.updated_at,
    updated_by: row.updated_by ?? undefined,
  };
}

// Pulls products/wallets/profiles/sales down into Dexie without clobbering a
// local row that still has a pending/failed mutation queued against it --
// the server hasn't seen that change yet, so its version of that specific
// row is stale relative to ours.
export async function pullFromSupabase(): Promise<void> {
  const [pendingProductIds, pendingWalletIds, pendingCategoryIds, pendingSaleIds, pendingProfileIds, pendingShopStatusIds] =
    await Promise.all([
      getPendingIds("product_id"),
      getPendingIds("wallet_id"),
      getPendingIds("category_id"),
      getPendingIds("sale_id"),
      getPendingIds("profile_id"),
      getPendingIds("shop_status_id"),
    ]);

  // Pulled before products so a fresh full-catalog pull has the referenced
  // rows locally first -- not load-bearing (Dexie has no FK enforcement),
  // just keeps one sync cycle internally consistent.
  const { data: categories, error: categoriesError } = await supabase.from("categories").select("*");
  if (categoriesError) {
    console.error("[syncService] failed to pull categories", categoriesError);
  } else {
    const toUpsert = categories.filter((row) => !pendingCategoryIds.has(row.id)).map(mapCategoryRow);
    if (toUpsert.length > 0) await db.categories.bulkPut(toUpsert);
  }

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

  // Sales were push-only until the student 360 profile needed a device's
  // local Dexie to reflect a student's *complete* purchase history, not just
  // whatever this one terminal happened to ring up itself. sale_items is
  // filtered by its parent sale's pending-ness (not its own id) -- items are
  // only ever written atomically with their sale, never independently.
  const { data: sales, error: salesError } = await supabase.from("sales").select("*");
  if (salesError) {
    console.error("[syncService] failed to pull sales", salesError);
  } else {
    const toUpsert = sales.filter((row) => !pendingSaleIds.has(row.id)).map(mapSaleRow);
    if (toUpsert.length > 0) await db.sales.bulkPut(toUpsert);
  }

  const { data: saleItems, error: saleItemsError } = await supabase.from("sale_items").select("*");
  if (saleItemsError) {
    console.error("[syncService] failed to pull sale items", saleItemsError);
  } else {
    const toUpsert = saleItems.filter((row) => !pendingSaleIds.has(row.sale_id)).map(mapSaleItemRow);
    if (toUpsert.length > 0) await db.sale_items.bulkPut(toUpsert);
  }

  // profiles: explicit column list only -- pin_code was never included in
  // the grant (migration 1), so a `select("*")` here would fail outright
  // with "permission denied for table profiles" (confirmed live in Phase 1.3).
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,email,full_name,first_name,last_name,avatar_url,preferred_language,role");
  if (profilesError) {
    console.error("[syncService] failed to pull profiles", profilesError);
  } else {
    for (const profile of profiles) {
      if (pendingProfileIds.has(profile.id)) continue;
      const existing = await db.profiles.get(profile.id);
      await db.profiles.put({
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        first_name: profile.first_name,
        last_name: profile.last_name,
        avatar_url: profile.avatar_url ?? undefined,
        preferred_language: profile.preferred_language,
        role: profile.role,
        // Preserve any locally-set PIN hash; a brand-new pulled profile has
        // none yet and fails closed until a future PIN-assignment flow sets
        // one -- an empty string never matches a real SHA-256 digest.
        pin_hash: existing?.pin_hash ?? "",
      });
    }
  }

  // shop_status: single fixed-id row (id 1) -- see the pending-mutation
  // guard above, keyed the same way as every other table here despite the
  // numeric id.
  const { data: shopStatus, error: shopStatusError } = await supabase
    .from("shop_status")
    .select("*")
    .eq("id", 1)
    .single();
  if (shopStatusError) {
    console.error("[syncService] failed to pull shop_status", shopStatusError);
  } else if (shopStatus && !pendingShopStatusIds.has(String(shopStatus.id))) {
    await db.shop_status.put(mapShopStatusRow(shopStatus));
  }
}
