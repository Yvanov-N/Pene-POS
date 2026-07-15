import Dexie, { type Table } from "dexie";
import type {
  Product,
  CartItem,
  Sale,
  SaleItem,
  StudentWallet,
  SyncQueueItem,
} from "@/types/db";

export class PosDatabase extends Dexie {
  products!: Table<Product, string>;
  cart_items!: Table<CartItem, string>;
  sales!: Table<Sale, string>;
  sale_items!: Table<SaleItem, string>;
  student_wallets!: Table<StudentWallet, string>;
  sync_queue!: Table<SyncQueueItem, number>;

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
  }
}

export const db = new PosDatabase();
