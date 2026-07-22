import type {
  MomoVerificationStatus,
  PaymentMethod,
  PreferredLanguage,
  SaleStatus,
  UserRole,
} from "@/types/supabase";

export type { MomoVerificationStatus, PaymentMethod, PreferredLanguage, SaleStatus };

export interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  // Server-generated (full_name is a Postgres `generated always as` column,
  // migration 00010) -- never written directly. Kept as a plain field here
  // (Dexie has no generated-column concept) and recomputed client-side via
  // computeFullName() wherever a Profile is constructed locally, so it stays
  // consistent between a pull and a not-yet-synced local edit.
  full_name: string;
  avatar_url?: string;
  preferred_language: PreferredLanguage;
  role: UserRole;
  // Locally-computed SHA-256 digest for offline PIN checks -- unrelated to
  // the server's bcrypt pin_code hash, which is intentionally never synced
  // down (see supabase/migrations/00001_initial_schema.sql). Phase 3 needs
  // to design the real secure sync path for this table.
  pin_hash: string;
}

export function computeFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
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
  // Orthogonal to `status` (which tracks offline push/sync state) -- whether
  // a MoMo sale's SMS confirmation has been checked is a separate concern.
  // Undefined/absent for cash and student_wallet sales, which never go
  // through MoMo verification at all.
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
  // Negative is a deliberately-allowed state representing student debt to
  // the shop (see migration 00010) -- nothing in the app currently produces
  // a negative value (withdrawal is capped at the current positive balance,
  // wallet-payment checkout already blocks insufficient balance client-side,
  // and adjust_wallet_balance itself now rejects any delta that would drive
  // it negative), but the dashboard's debt-tracking widgets are built
  // against this being a real, expected possibility for whenever a future
  // feature does allow it.
  balance: number;
  email: string;
  email_opt_in: boolean;
  phone: string;
}

export type SyncAction = "INSERT" | "UPDATE" | "DELETE" | "SALE" | "WALLET_RECHARGE" | "WALLET_WITHDRAWAL";

export type SyncStatus = "pending" | "syncing" | "completed" | "failed" | "conflict_warning";

export interface SalePayload {
  sale: Sale;
  items: SaleItem[];
}

export interface WalletBalancePayload {
  wallet_id: string;
  delta: number;
}

// The generic INSERT/UPDATE/DELETE path (products/categories/student_wallets
// /profiles/shop_status admin CRUD) -- payload shape varies per table, but
// every caller needs at least the row's id (pushGeneric's .eq("id", id) and
// getPendingIds' pending-id tracking both rely on it being present). id is
// string | number, not just string: shop_status's fixed primary key (1) is a
// real number, not a uuid like every other table here.
export interface GenericMutationPayload extends Record<string, unknown> {
  id: string | number;
}

interface SyncQueueItemBase {
  id?: number;
  table_name: string;
  created_at: string;
  status: SyncStatus;
  retryCount: number;
  // Set from the caught error on a failed push attempt, cleared again on the
  // next successful (or conflict) outcome -- surfaced by the sync badge's
  // error state and meant for an admin looking at a stuck item, not just
  // console.error output nobody but a developer ever sees.
  errorMessage?: string;
  // Per-item override for MAX_RETRIES (syncService.ts) -- optional and
  // unused by every current call site, which all get the shared default.
  // Exists for a future mutation type that might legitimately need a
  // different retry budget (e.g. give up immediately on something
  // non-idempotent) without that becoming a reason to change the global
  // constant for everything else.
  maxRetries?: number;
}

// Discriminated by `action` -- narrows `payload` to the right shape at every
// read site (syncService.ts, conflictResolver.ts) instead of the manual
// `as SalePayload` / `as WalletRechargePayload` casts a plain
// `Record<string, any>` payload used to force.
export type SyncQueueItem =
  | (SyncQueueItemBase & { action: "SALE"; payload: SalePayload })
  | (SyncQueueItemBase & { action: "WALLET_RECHARGE" | "WALLET_WITHDRAWAL"; payload: WalletBalancePayload })
  | (SyncQueueItemBase & { action: "INSERT" | "UPDATE" | "DELETE"; payload: GenericMutationPayload });

// Singleton row (id is always 1) -- mirrors public.shop_status.
export interface ShopStatus {
  id: number;
  is_open: boolean;
  updated_at: string;
  updated_by?: string;
}

export type PrintMode = "browser" | "bluetooth";

// Device-local preferences only -- print mode and the paired Bluetooth
// printer are inherently per-terminal, not shop-wide business data, so this
// deliberately never goes through sync_queue/Supabase.
export interface LocalSettings {
  id: string;
  printMode: PrintMode;
  autoPrintReceipts: boolean;
}
