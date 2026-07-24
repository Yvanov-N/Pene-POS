// Hand-maintained wrapper around the CLI-generated supabase-generated.ts
// (regenerate that file with `pnpm db:types`, never hand-edit it directly).
// This file exists so the rest of the app can keep importing a small set of
// stable, narrowed names (UserRole, PaymentMethod, SaleStatus, ...) instead
// of reaching into Database["public"]["Enums"][...] everywhere, and so a
// migration can't silently drift these two representations apart the way
// the old hand-authored supabase.ts drifted from the real schema (it was
// missing sales.id_text, added in migration 00020, among other gaps).

import type { Database as GeneratedDatabase, Json } from "@/types/supabase-generated";

export type { Json };
export type Database = GeneratedDatabase;

export type UserRole = Database["public"]["Enums"]["user_role"];
export type PaymentMethod = Database["public"]["Enums"]["payment_method"];

// The raw Postgres enum still has all 4 historical values (migrations are
// additive-only -- an enum value, once added, is never removed). This
// narrower alias is what the client actually ever writes or expects to see
// server-side now: complete_sale/void_sale force 'completed'/'refunded'
// respectively, and 'pending_sync'/'conflict_warning' were always a purely
// local Dexie concept (see the old syncService.ts's processSyncQueue) that
// never actually got pushed to the remote sales.status column. Sync state
// itself now lives entirely in the local outbox (types/db.ts's
// OutboxOperation), never in this business-status field.
export type SaleStatus = "completed" | "refunded";

// CHECK-constrained text columns, not real Postgres enum types (see
// migrations 00004, 00010) -- the generator types these as plain `string`,
// so the narrower literal unions are hand-maintained here for the same
// reason SaleStatus is: real type safety at every read/write site.
export type MomoVerificationStatus = "pending" | "confirmed" | "rejected";
export type PreferredLanguage = "fr" | "en";

// Structured RPC outcomes (sync rebuild) -- every mutating RPC added this
// phase (complete_sale, adjust_wallet_balance, adjust_product_stock,
// void_sale, all 4-arg/operation_id overloads) returns one of these jsonb
// shapes instead of relying on the caller to sniff a Postgres SQLSTATE.
export type SyncRpcOutcome = "completed" | "replayed" | "conflict";

export interface SyncRpcResult {
  outcome: SyncRpcOutcome;
  operation_id: string;
  reason?: string;
  [key: string]: unknown;
}
