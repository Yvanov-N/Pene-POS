import type { UserRole } from "@/types/supabase";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  // Locally-computed SHA-256 digest for offline PIN checks -- unrelated to
  // the server's bcrypt pin_code hash, which is intentionally never synced
  // down (see supabase/migrations/00001_initial_schema.sql). Phase 3 needs
  // to design the real secure sync path for this table.
  pin_hash: string;
}

export interface Category {
  id: string;
  name: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  barcode?: string;
  category_id?: string;
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

export type SaleStatus = "completed" | "pending_sync" | "conflict_warning" | "refunded";

// Orthogonal to SaleStatus (which tracks offline push/sync state) -- whether
// a MoMo sale's SMS confirmation has been checked is a separate concern.
// Undefined/absent for cash and student_wallet sales, which never go through
// MoMo verification at all.
export type MomoVerificationStatus = "pending" | "confirmed" | "rejected";

export interface Sale {
  id: string;
  created_at: string;
  cashier_id: string;
  total_amount: number;
  payment_method: PaymentMethod;
  // The student this sale is attributed to, for any payment method --
  // required when payment_method is "student_wallet" (that's whose balance
  // gets debited), optional/CRM-only attribution otherwise (a cashier can
  // tag a cash/MoMo sale to a student, or skip it for an anonymous sale).
  student_id?: string;
  status: SaleStatus;
  momo_verification_status?: MomoVerificationStatus;
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

export type SyncStatus = "pending" | "syncing" | "completed" | "failed" | "conflict_warning";

export interface SyncQueueItem {
  id?: number;
  action: SyncAction;
  table_name: string;
  payload: Record<string, any>;
  created_at: string;
  status: SyncStatus;
  retryCount: number;
}

export type PrintMode = "browser" | "bluetooth";

// Device-local preferences only -- print mode and the paired Bluetooth
// printer are inherently per-terminal, not shop-wide business data, so this
// deliberately never goes through sync_queue/Supabase.
export interface LocalSettings {
  id: string;
  printMode: PrintMode;
}
