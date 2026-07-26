import type { Table } from "dexie";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { computeFullName, type Category, type Product, type Profile, type Sale, type SaleItem, type ShopStatus, type StudentWallet } from "@/types/db";
import type { Database } from "@/types/supabase";

// ============================================================================
// Incremental, cursor-based pulls -- replaces the old pullFromSupabase()'s
// unconditional full-table select("*") on every cycle. Each syncable table
// carries a sync_seq watermark (migration 00022, stamped by a generic
// trigger on every insert/update, including ones that go through no RPC at
// all) -- a pull asks only for rows whose sync_seq is greater than what this
// device has already ingested (db.sync_cursors), then advances the cursor.
//
// This closes the actual clobber gap the old approach had: pullFromSupabase
// bulkPut every row it fetched unconditionally, with no "is this actually
// newer than what I already have" check at all -- only a pending-mutation-id
// exclusion set stood between a stale full-table page and a fresher local
// write. Here, a row whose local edit hasn't synced yet simply keeps its
// pre-edit sync_seq, so it isn't even re-fetched by the next `gt(cursor)`
// pull in the first place (the cursor advance IS the guard); the per-row
// "only accept if newer" comparison below is defense in depth on top of
// that, for out-of-order batch delivery or a full resync (cursor reset).
// ============================================================================

const PULL_BATCH_SIZE = 500;

async function getCursor(tableName: string): Promise<number> {
  const row = await db.sync_cursors.get(tableName);
  return row?.cursor ?? 0;
}

async function setCursor(tableName: string, cursor: number): Promise<void> {
  await db.sync_cursors.put({ tableName, cursor });
}

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type WalletRow = Database["public"]["Tables"]["student_wallets"]["Row"];
type SaleRow = Database["public"]["Tables"]["sales"]["Row"];
type SaleItemRow = Database["public"]["Tables"]["sale_items"]["Row"];
type ShopStatusRow = Database["public"]["Tables"]["shop_status"]["Row"];
// Only the columns this pull actually requests -- pin_code was never
// granted (see that select's own comment below), so a `select("*")` here
// would fail outright with "permission denied for table profiles".
type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "email" | "full_name" | "first_name" | "last_name" | "avatar_url" | "preferred_language" | "role" | "sync_seq"
>;

export function mapProductRow(row: ProductRow): Product {
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
    sync_seq: row.sync_seq,
  };
}

function mapCategoryRow(row: CategoryRow): Category {
  return { id: row.id, name: row.name, updated_at: row.updated_at, sync_seq: row.sync_seq };
}

export function mapWalletRow(row: WalletRow): StudentWallet {
  return {
    id: row.id,
    student_name: row.student_name,
    badge_code: row.badge_code,
    balance: row.balance,
    email: row.email ?? "",
    email_opt_in: row.email_opt_in,
    phone: row.phone ?? "",
    updated_at: row.updated_at,
    sync_seq: row.sync_seq,
  };
}

export function mapSaleRow(row: SaleRow): Sale {
  return {
    id: row.id,
    created_at: row.created_at,
    cashier_id: row.cashier_id,
    device_label: row.device_label ?? undefined,
    total_amount: row.total_amount,
    payment_method: row.payment_method,
    student_id: row.student_id ?? undefined,
    // Narrowed at the type level to "completed" | "refunded" (types/db.ts) --
    // the server only ever writes one of those two for a real row (see
    // complete_sale/void_sale); the cast reflects that guarantee rather than
    // re-litigating it against the wider raw Postgres enum on every pull.
    status: row.status as Sale["status"],
    momo_verification_status: (row.momo_verification_status as Sale["momo_verification_status"]) ?? undefined,
    updated_at: row.updated_at,
    sync_seq: row.sync_seq,
  };
}

function mapSaleItemRow(row: SaleItemRow): SaleItem {
  return {
    id: row.id,
    sale_id: row.sale_id,
    product_id: row.product_id,
    quantity: row.quantity,
    unit_price: row.unit_price,
    updated_at: row.updated_at,
    sync_seq: row.sync_seq,
  };
}

function mapShopStatusRow(row: ShopStatusRow): ShopStatus {
  return {
    id: row.id,
    is_open: row.is_open,
    updated_at: row.updated_at,
    updated_by: row.updated_by ?? undefined,
    sync_seq: row.sync_seq,
  };
}

// Shared "only accept if newer" merge, by sync_seq -- exported for the few
// other direct/one-off remote reads outside the main pullAll() cycle
// (useNetworkFirstQuery's stale-while-revalidate writeBack callbacks in
// usePosCheckout.ts, ProductGrid.tsx, useDashboardWidgetData.ts) that also
// bulkPut a remote fetch's result straight into Dexie and need the exact
// same protection against overwriting a fresher, not-yet-synced local
// optimistic write with a stale value. This is what replaces the old
// getPendingIds()-based exclusion set app-wide, not just inside the main
// pull cycle below.
export async function writeBackIfNewer<
  TKey extends string | number,
  Row extends { id: TKey; sync_seq?: number },
  Local extends { sync_seq?: number },
>(table: Table<Local, TKey>, rows: Row[], mapRow: (row: Row) => Local): Promise<void> {
  for (const row of rows) {
    const local = await table.get(row.id);
    if (!local || (local.sync_seq ?? 0) < (row.sync_seq ?? 0)) {
      await table.put(mapRow(row) as Local & { id: TKey });
    }
  }
}

// Generic incremental pull for a table with a plain, non-soft-deletable
// shape: fetch rows past the local cursor, "only accept if newer" merge
// each one, advance the cursor, page if the batch was full.
async function pullTable<TKey extends string | number, Row extends { id: TKey; sync_seq: number }, Local extends { sync_seq?: number }>(
  tableName: string,
  localTable: Table<Local, TKey>,
  select: string,
  mapRow: (row: Row) => Local,
): Promise<void> {
  const cursor = await getCursor(tableName);
  const { data, error } = await supabase
    // tableName is an arbitrary runtime string, not a literal keyof
    // Database["public"]["Tables"] -- see push.ts's pushGenericMutation for
    // the same `as never` escape hatch and why it's safe here.
    .from(tableName as never)
    .select(select)
    .gt("sync_seq", cursor)
    .order("sync_seq", { ascending: true })
    .limit(PULL_BATCH_SIZE);

  if (error) {
    console.error(`[sync/pull] failed to pull ${tableName}`, error);
    return;
  }
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return;

  await writeBackIfNewer(localTable, rows, mapRow);

  await setCursor(tableName, rows[rows.length - 1].sync_seq);
  if (rows.length === PULL_BATCH_SIZE) await pullTable(tableName, localTable, select, mapRow);
}

// products/categories: soft-deletable (migration 00023). A row pulled with
// deleted_at set is removed locally rather than upserted -- the tombstone
// only needs to exist server-side, to make the deletion visible to a
// cursor-based pull at all; every existing local read call site (ProductGrid,
// admin tables, ...) already treats "absent from Dexie" as "deleted" and
// needs no changes to keep meaning that.
async function pullSoftDeletableTable<Row extends { id: string; sync_seq: number; deleted_at: string | null }>(
  tableName: string,
  localTable: Table<{ id: string; sync_seq?: number }, string>,
  mapRow: (row: Row) => { id: string; sync_seq?: number },
): Promise<void> {
  const cursor = await getCursor(tableName);
  const { data, error } = await supabase
    .from(tableName as never)
    .select("*")
    .gt("sync_seq", cursor)
    .order("sync_seq", { ascending: true })
    .limit(PULL_BATCH_SIZE);

  if (error) {
    console.error(`[sync/pull] failed to pull ${tableName}`, error);
    return;
  }
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return;

  for (const row of rows) {
    if (row.deleted_at) {
      await localTable.delete(row.id);
      continue;
    }
    const local = await localTable.get(row.id);
    if (!local || (local.sync_seq ?? 0) < row.sync_seq) {
      await localTable.put(mapRow(row));
    }
  }

  await setCursor(tableName, rows[rows.length - 1].sync_seq);
  if (rows.length === PULL_BATCH_SIZE) await pullSoftDeletableTable(tableName, localTable, mapRow);
}

async function pullProfiles(): Promise<void> {
  const cursor = await getCursor("profiles");
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,first_name,last_name,avatar_url,preferred_language,role,sync_seq")
    .gt("sync_seq", cursor)
    .order("sync_seq", { ascending: true })
    .limit(PULL_BATCH_SIZE);

  if (error) {
    console.error("[sync/pull] failed to pull profiles", error);
    return;
  }
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length === 0) return;

  for (const row of rows) {
    const local = await db.profiles.get(row.id);
    if (local && (local.sync_seq ?? 0) >= row.sync_seq) continue;
    await db.profiles.put({
      id: row.id,
      email: row.email,
      // Computed locally rather than trusting row.full_name directly --
      // it's a generated STORED column server-side (migration 00010) and
      // the generator reports it as nullable at the type level even though
      // it's practically always populated; deriving it the same way the
      // server does avoids ever propagating a null here.
      full_name: computeFullName(row.first_name, row.last_name),
      first_name: row.first_name,
      last_name: row.last_name,
      avatar_url: row.avatar_url ?? undefined,
      preferred_language: row.preferred_language as Profile["preferred_language"],
      role: row.role,
      sync_seq: row.sync_seq,
      // Preserve any locally-set PIN hash; a brand-new pulled profile has
      // none yet and fails closed until a future PIN-assignment flow sets
      // one -- an empty string never matches a real SHA-256 digest.
      pin_hash: local?.pin_hash ?? "",
    });
  }

  await setCursor("profiles", rows[rows.length - 1].sync_seq);
  if (rows.length === PULL_BATCH_SIZE) await pullProfiles();
}

export async function pullAll(): Promise<void> {
  // Categories before products so a fresh pull has the referenced rows
  // locally first -- not load-bearing (Dexie has no FK enforcement), just
  // keeps one sync cycle internally consistent.
  await pullSoftDeletableTable("categories", db.categories, mapCategoryRow);
  await pullSoftDeletableTable("products", db.products, mapProductRow);
  await pullTable("student_wallets", db.student_wallets, "*", mapWalletRow);
  // Sales/sale_items are pulled (not push-only) so a device's local Dexie
  // reflects a student's complete purchase history across every terminal,
  // not just what this one till happened to ring up itself.
  await pullTable("sales", db.sales, "*", mapSaleRow);
  await pullTable("sale_items", db.sale_items, "*", mapSaleItemRow);
  await pullProfiles();
  await pullTable("shop_status", db.shop_status, "*", mapShopStatusRow);
}
