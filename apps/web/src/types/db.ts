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
  // Cursor watermark for incremental pulls (migration 00022) -- absent on a
  // row that only ever existed locally and has never round-tripped through a
  // pull (shouldn't normally happen for profiles, which are admin-created
  // server-side, but kept optional rather than assumed for defensiveness).
  sync_seq?: number;
}

export function computeFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export interface Category {
  id: string;
  name: string;
  updated_at: string;
  sync_seq?: number;
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
  sync_seq?: number;
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
  // Which admin's PIN authorized this checkout (checkout now only accepts
  // an admin PIN -- see hooks/usePosCheckout.ts) -- kept as an audit trail,
  // no longer the primary "who/where" identity shown to users. That's
  // device_label below.
  cashier_id: string;
  total_amount: number;
  payment_method: PaymentMethod;
  // The device that rang this up (auto-detected platform + an admin-set
  // location name, e.g. "macos-yaounde" -- see lib/deviceLabel.ts), shown
  // on receipts/Sales History/etc. in place of a cashier's name. Undefined
  // for historical sales made before this existed, or for a device with no
  // location configured yet -- display falls back to the cashier's name
  // (via cashier_id) in that case, same as before this feature existed.
  device_label?: string;
  // The student this sale is attributed to, for any payment method --
  // required when payment_method is "student_wallet" (that's whose balance
  // gets debited), optional/CRM-only attribution otherwise (a cashier can
  // tag a cash/MoMo sale to a student, or skip it for an anonymous sale).
  student_id?: string;
  // Pure business lifecycle now ("completed" | "refunded") -- sync state
  // (is this row durably on the server yet?) lives entirely in the local
  // outbox (OutboxOperation below), never here. A sale is "completed" the
  // instant it's committed locally (see hooks/usePosCheckout.ts), whether or
  // not its outbox entry has synced yet -- look up the matching outbox row
  // by operation id (services/sync/conflicts.ts) for that answer instead.
  status: SaleStatus;
  // Orthogonal to `status` -- whether a MoMo sale's SMS confirmation has been
  // checked is a separate concern. Undefined/absent for cash and
  // student_wallet sales, which never go through MoMo verification at all.
  momo_verification_status?: MomoVerificationStatus;
  updated_at: string;
  sync_seq?: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  updated_at: string;
  sync_seq?: number;
}

export interface StudentWallet {
  id: string;
  student_name: string;
  badge_code: string;
  // Negative is a deliberately-allowed state representing student debt to
  // the shop (migration 00019) -- surfaced via the admin dashboard's debt
  // widgets, never blocked by the sync layer.
  balance: number;
  email: string;
  email_opt_in: boolean;
  phone: string;
  updated_at: string;
  sync_seq?: number;
}

export type SyncRpcOutcome = "completed" | "replayed" | "conflict";

// One outcome vocabulary for every local write, generic or RPC-backed --
// replaces the old "cloud"/"local" WriteMode. "synced": landed on the server
// during this call. "queued": offline, timed out, or an unexpected error --
// stays in the outbox for the periodic drain to retry. "conflict": the
// server explicitly rejected this operation for a reason retrying won't fix
// (deleted product, duplicate badge_code, already-refunded sale, etc.) --
// terminal until an admin resolves it via services/sync/conflicts.ts.
export type PushOutcome = "synced" | "queued" | "conflict";

export type OutboxStatus = "pending" | "syncing" | "synced" | "conflict" | "error";

// Mirrors the op_type strings written into public.sync_operations
// server-side (supabase/migrations/00024 onward) so a sync_events/
// sync_operations row can always be correlated back to the local outbox
// entry that produced it, by operationId.
export type OutboxOpType =
  | "complete_sale"
  | "adjust_wallet_balance"
  | "adjust_product_stock"
  | "void_sale"
  | "generic_insert"
  | "generic_update"
  | "generic_delete";

export interface CompleteSalePayload {
  sale: Sale;
  items: SaleItem[];
}

export interface AdjustWalletBalancePayload {
  wallet_id: string;
  delta: number;
  reason?: string;
}

export interface AdjustProductStockPayload {
  product_id: string;
  delta: number;
  reason?: string;
}

export interface VoidSalePayload {
  sale_id: string;
  admin_id: string;
}

// The generic INSERT/UPDATE/DELETE path (products/categories/student_wallets
// /profiles/shop_status admin CRUD not covered by a dedicated RPC) -- payload
// shape varies per table, but every caller needs at least the row's id
// (pushGeneric's .eq("id", id) relies on it being present). id is
// string | number, not just string: shop_status's fixed primary key (1) is a
// real number, not a uuid like every other table here. A "generic_delete"
// entry is translated server-side into `UPDATE ... SET deleted_at = now()`
// for products/categories (soft delete, migration 00023) rather than an
// actual DELETE -- see services/sync/push.ts -- so the payload shape for a
// delete is the same {id} shape as everything else, no deleted_at needed at
// the call site.
export interface GenericMutationPayload extends Record<string, unknown> {
  id: string | number;
}

export type OutboxPayload =
  | CompleteSalePayload
  | AdjustWalletBalancePayload
  | AdjustProductStockPayload
  | VoidSalePayload
  | GenericMutationPayload;

interface OutboxOperationBase {
  id?: number;
  // Client-generated, matches public.sync_operations.id server-side for the
  // 4 ledger-guarded op types (complete_sale/adjust_wallet_balance/
  // adjust_product_stock/void_sale). Generated but not ledger-checked for
  // the 3 generic_* op types (see services/sync/push.ts) -- those are
  // naturally idempotent plain field writes, so operationId there is only
  // used for local correlation/telemetry, not a server-side replay guard.
  operationId: string;
  tableName: string;
  createdAt: string;
  status: OutboxStatus;
  retryCount: number;
  maxRetries?: number;
  errorMessage?: string;
  conflictReason?: string;
}

// Discriminated by `opType` -- narrows `payload` to the right shape at every
// read site (services/sync/push.ts, conflicts.ts), same pattern the old
// SyncQueueItem used for `action`.
export type OutboxOperation =
  | (OutboxOperationBase & { opType: "complete_sale"; payload: CompleteSalePayload })
  | (OutboxOperationBase & { opType: "adjust_wallet_balance"; payload: AdjustWalletBalancePayload })
  | (OutboxOperationBase & { opType: "adjust_product_stock"; payload: AdjustProductStockPayload })
  | (OutboxOperationBase & { opType: "void_sale"; payload: VoidSalePayload })
  | (OutboxOperationBase & {
      opType: "generic_insert" | "generic_update" | "generic_delete";
      payload: GenericMutationPayload;
    });

// Singleton row (id is always 1) -- mirrors public.shop_status.
export interface ShopStatus {
  id: number;
  is_open: boolean;
  updated_at: string;
  updated_by?: string;
  sync_seq?: number;
}

export type PrintMode = "browser" | "bluetooth";

// Device-local preferences only -- print mode and the paired Bluetooth
// printer are inherently per-terminal, not shop-wide business data, so this
// deliberately never goes through the outbox/Supabase.
export interface LocalSettings {
  id: string;
  printMode: PrintMode;
  autoPrintReceipts: boolean;
  // Admin-set once per device (Settings > Device), e.g. "yaounde" -- combined
  // with an auto-detected platform (lib/deviceLabel.ts) into a full label
  // like "macos-yaounde" for sales attribution. Undefined until an admin
  // sets it; the label falls back to just the platform until then.
  deviceLocation?: string;
}

// Per-table incremental-pull watermark (services/sync/pull.ts). One row per
// syncable table name, storing the highest sync_seq ingested so far -- the
// next pull asks the server for strictly greater values only, instead of
// re-fetching the whole table every cycle.
export interface SyncCursor {
  tableName: string;
  cursor: number;
}
