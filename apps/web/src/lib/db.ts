import Dexie, { type Table } from "dexie";
import type {
  Category,
  Product,
  CartItem,
  Sale,
  SaleItem,
  StudentWallet,
  SyncQueueItem,
  Profile,
  LocalSettings,
} from "@/types/db";

export class PosDatabase extends Dexie {
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  cart_items!: Table<CartItem, string>;
  sales!: Table<Sale, string>;
  sale_items!: Table<SaleItem, string>;
  student_wallets!: Table<StudentWallet, string>;
  sync_queue!: Table<SyncQueueItem, number>;
  profiles!: Table<Profile, string>;
  local_settings!: Table<LocalSettings, string>;

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
  }
}

export const db = new PosDatabase();
