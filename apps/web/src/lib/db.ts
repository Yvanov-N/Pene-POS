import Dexie, { type Table } from "dexie";
import type {
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
  }
}

export const db = new PosDatabase();
