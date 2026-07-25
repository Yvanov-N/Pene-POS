import Dexie, { type Table } from "dexie";
import type {
  Category,
  Product,
  CartItem,
  Sale,
  SaleItem,
  StudentWallet,
  Profile,
  LocalSettings,
  ShopStatus,
  OutboxOperation,
  OutboxOpType,
  SyncCursor,
} from "@/types/db";
import { MOCK_CASHIER_EMAIL, CATEGORY_IDS, PRODUCT_IDS } from "@/lib/mockSeedIds";

export class PosDatabase extends Dexie {
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  cart_items!: Table<CartItem, string>;
  sales!: Table<Sale, string>;
  sale_items!: Table<SaleItem, string>;
  student_wallets!: Table<StudentWallet, string>;
  sync_outbox!: Table<OutboxOperation, number>;
  sync_cursors!: Table<SyncCursor, string>;
  profiles!: Table<Profile, string>;
  local_settings!: Table<LocalSettings, string>;
  shop_status!: Table<ShopStatus, number>;

  constructor() {
    super("pene_pos");

    this.version(1).stores({
      products: "id, barcode, category, expiry_date, updated_at",
      cart_items: "id, product_id",
      sales: "id, status, created_at",
      sale_items: "id, sale_id",
      student_wallets: "id, badge_code, email",
      sync_queue: "++id, status, created_at",
    });

    this.version(2).stores({
      profiles: "id, role",
    });

    this.version(3).stores({
      local_settings: "id",
    });

    // Adds a product_id index to sale_items -- ProductsPage's delete guard
    // needs to check "has this product ever been sold" (the server rejects
    // deleting a product referenced by historical sale_items, no ON DELETE
    // clause -> RESTRICT) without a full table scan. Purely additive: Dexie
    // builds the new index over existing rows, no data migration needed.
    this.version(4).stores({
      sale_items: "id, sale_id, product_id",
    });

    // Product categories become a real entity (categories table) instead of
    // a free-text string on Product -- products now index category_id
    // instead of category. No async .upgrade() data migration: an existing
    // local product simply falls back to "no category" until the next
    // pullFromSupabase() restores it from the server's authoritative,
    // migration-backfilled category_id. Generating a matching local
    // category id independently here would never line up with the id the
    // server's own backfill picks for the same name.
    this.version(5).stores({
      categories: "id, name",
      products: "id, barcode, category_id, expiry_date, updated_at",
    });

    // Adds a student_id index to sales -- the student directory/profile
    // drawer needs "every sale linked to this student" (lifetime spend,
    // order count, purchase history) without a full table scan, the same
    // reasoning as sale_items' product_id index in version 4.
    this.version(6).stores({
      sales: "id, status, created_at, student_id",
    });

    // Phase 12 offline-first audit: useShopStatus previously read/wrote
    // shop_status directly against Supabase with no local mirror at all --
    // the one hook in the app that simply didn't work offline. A real Dexie
    // table (fixed single row, id always 1) makes it follow the same
    // local-write-then-sync pattern as everything else.
    this.version(7).stores({
      shop_status: "id",
    });

    // Sync rebuild: the outbox replaces sync_queue outright (single
    // OutboxStatus vocabulary instead of the old dual Sale.status/
    // SyncQueueItem.status split -- see types/db.ts). sync_cursors backs
    // the new incremental, sync_seq-based pull (services/sync/pull.ts) in
    // place of the old full-table select("*") on every cycle.
    //
    // sync_queue is deliberately still declared as of THIS version (its v1
    // definition carries forward unchanged, Dexie only needs a table
    // re-listed when its own schema/indexes change) so the upgrade() below
    // can read it -- only version 9 actually drops it. Dropping and reading
    // the same store within one version's upgrade() is not a safe Dexie
    // pattern; splitting across two versions is.
    this.version(8)
      .stores({
        // operationId indexed -- it's the primary correlation key now
        // (confirmSynced, push-result matching, telemetry), looked up far
        // more often than any other field besides status/createdAt.
        sync_outbox: "++id, operationId, status, createdAt",
        sync_cursors: "tableName",
      })
      .upgrade(async (tx) => {
        const oldQueue = await tx.table("sync_queue").toArray();

        // Only actually-unresolved work carries forward -- a "completed"
        // queue row is historical noise under the old model (never pruned,
        // per that table's own comment), not something the new drain needs
        // to see. This does mean any dashboard metric that used to scan
        // *completed* sync_queue rows for history (useDashboardAnalytics'
        // wallet-recharge widget) starts its window fresh from this
        // migration forward rather than replaying old data -- an accepted,
        // explicit trade-off (that widget's own definition is changing
        // anyway under the new architecture, see that file's comments) over
        // migrating stale rows just to preserve a number.
        const migrated: OutboxOperation[] = oldQueue
          .filter((item) => item.status === "pending" || item.status === "failed" || item.status === "conflict_warning")
          .map((item): OutboxOperation => {
            const opType: OutboxOpType =
              item.action === "SALE"
                ? "complete_sale"
                : item.action === "WALLET_RECHARGE" || item.action === "WALLET_WITHDRAWAL"
                  ? "adjust_wallet_balance"
                  : item.action === "INSERT"
                    ? "generic_insert"
                    : item.action === "DELETE"
                      ? "generic_delete"
                      : "generic_update";

            const payload =
              item.action === "SALE"
                ? { sale: item.payload.sale, items: item.payload.items }
                : item.action === "WALLET_RECHARGE" || item.action === "WALLET_WITHDRAWAL"
                  ? { wallet_id: item.payload.wallet_id, delta: item.payload.delta }
                  : item.payload;

            return {
              // A fresh operation id, not carried over from the old queue
              // row (which never had one) -- safe: this row never
              // successfully synced under the old id-less scheme either, so
              // there's no prior server-side idempotency record for it to
              // collide with.
              operationId: crypto.randomUUID(),
              opType,
              tableName: item.table_name,
              payload,
              // A migrated conflict stays a conflict -- still needs the same
              // admin resolution it did before, just surfaced through the
              // new Sync Health view instead of the old dashboard.
              status: item.status === "conflict_warning" ? "conflict" : "pending",
              retryCount: item.retryCount ?? 0,
              maxRetries: item.maxRetries,
              errorMessage: item.errorMessage,
              createdAt: item.created_at,
            } as OutboxOperation;
          });

        if (migrated.length > 0) {
          await tx.table("sync_outbox").bulkAdd(migrated);
        }

        // sales.status no longer has "pending_sync"/"conflict_warning" in
        // its type (those were always a purely local sync-bookkeeping
        // concept smuggled into a business column) -- normalize any
        // existing local row still carrying one of those values. The
        // outbox migration above already preserved the "still needs
        // attention" signal for a genuine conflict via its own status, so
        // nothing is lost by flipping the sale itself to "completed" here.
        const staleSales = await tx
          .table("sales")
          .where("status")
          .anyOf(["pending_sync", "conflict_warning"])
          .toArray();
        for (const sale of staleSales) {
          await tx.table("sales").update(sale.id, { status: "completed" });
        }
      });

    this.version(9).stores({
      sync_queue: null,
    });

    // Production incident cleanup: seedLocalProfiles/Categories/Products
    // (lib/seedLocalProfiles.ts etc.) ran unconditionally on every device
    // for a long time, with no import.meta.env.DEV gate -- a brand-new
    // production device, before its first real pullAll() ever completed,
    // would get seeded with a fake "cashier@penepos.test" profile (random
    // id, never a real Supabase row -- any sale rung up under it hit
    // sales_cashier_id_fkey forever) and fixed-id mock categories/products
    // that only ever existed in the LOCAL dev Supabase project. That gate
    // now exists (AppShell.tsx), but any device that already cached these
    // rows before this fix shipped needs them removed, or the same PIN/
    // products keep silently producing unsyncable data. Production-only
    // (import.meta.env.PROD) -- local dev intentionally keeps this mock
    // data, since no real cashier/product catalog is seeded for dev either.
    this.version(10)
      .stores({})
      .upgrade(async (tx) => {
        if (import.meta.env.PROD) {
          await purgeMockSeedData({
            profiles: tx.table("profiles"),
            categories: tx.table("categories"),
            products: tx.table("products"),
          });
        }
      });
  }
}

// Exported (not inlined in the upgrade callback above) so it can be tested
// directly against a real db instance, independent of the import.meta.env
// gate that decides whether it actually runs on a real device.
export async function purgeMockSeedData(tables: {
  profiles: Table<Profile, string>;
  categories: Table<Category, string>;
  products: Table<Product, string>;
}): Promise<void> {
  // profiles has no index on email (only id, role) -- a plain filter scan
  // is fine here, this only ever runs once per device, if at all.
  await tables.profiles.filter((p) => p.email === MOCK_CASHIER_EMAIL).delete();
  await tables.categories.where("id").anyOf(Object.values(CATEGORY_IDS)).delete();
  await tables.products.where("id").anyOf(Object.values(PRODUCT_IDS)).delete();
}

export const db = new PosDatabase();
