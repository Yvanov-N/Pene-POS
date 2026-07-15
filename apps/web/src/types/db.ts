export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  barcode?: string;
  category?: string;
  image_url?: string;
  emoji?: string;
  expiry_date?: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url?: string;
  emoji?: string;
}

export type PaymentMethod = "cash" | "momo_mtn" | "momo_orange" | "student_wallet";

export type SaleStatus = "completed" | "pending_sync" | "conflict_warning";

export interface Sale {
  id: string;
  created_at: string;
  cashier_id: string;
  total_amount: number;
  payment_method: PaymentMethod;
  student_wallet_id?: string;
  status: SaleStatus;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface StudentWallet {
  id: string;
  student_name: string;
  badge_code: string;
  balance: number;
  email: string;
}

export type SyncAction = "INSERT" | "UPDATE" | "DELETE" | "SALE" | "WALLET_RECHARGE";

export type SyncStatus = "pending" | "syncing" | "failed" | "conflict_warning";

export interface SyncQueueItem {
  id?: number;
  action: SyncAction;
  table_name: string;
  payload: Record<string, any>;
  created_at: string;
  status: SyncStatus;
}
