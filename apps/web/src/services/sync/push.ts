import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { getIsOnlineSnapshot } from "@/lib/networkStatusStore";
import { extractErrorMessage } from "@/services/sync/outbox";
import { logSyncEvent } from "@/services/sync/telemetry";
import type { OutboxOperation, PushOutcome } from "@/types/db";
import type { Json, SyncRpcResult } from "@/types/supabase";

// ============================================================================
// Push primitives -- one per RPC/mutation shape, plus pushOutbox() which
// dispatches by opType and reconciles the outcome back onto the outbox row.
// The 4 ledger-guarded RPCs (complete_sale, adjust_wallet_balance,
// adjust_product_stock, void_sale -- supabase/migrations 00024-00029) return
// a structured jsonb outcome (SyncRpcResult) instead of a Postgres SQLSTATE
// to sniff; only the generic CRUD path (plain insert/update against tables
// with no dedicated RPC) still classifies a handful of Postgres error codes,
// since a plain PostgREST call has no structured-outcome mechanism of its
// own to lean on.
// ============================================================================

// Mirrors useNetworkStatus.ts's PING_TIMEOUT_MS pattern -- without this, a
// hung request has no bound (lib/supabase.ts's client passes no fetch/
// timeout options), and drainOutbox awaits every item sequentially, so one
// hang would otherwise block the entire sync cycle. 15s (vs. the 4s
// connectivity ping) because this covers real writes, not a lightweight
// health check, on what may be a slow campus connection.
const PUSH_TIMEOUT_MS = 15000;

const CHECK_VIOLATION_CODE = "23514";
const FOREIGN_KEY_VIOLATION_CODE = "23503";
const UNIQUE_VIOLATION_CODE = "23505";

type QueueOutcome = "completed" | "conflict";

async function pushCompleteSale(
  entry: Extract<OutboxOperation, { opType: "complete_sale" }>,
  signal: AbortSignal,
): Promise<SyncRpcResult> {
  const { sale, items } = entry.payload;
  const { data, error } = await supabase
    .rpc("complete_sale", {
      p_operation_id: entry.operationId,
      p_sale: sale as unknown as Json,
      p_items: items as unknown as Json,
    })
    .abortSignal(signal);
  if (error) throw error;
  return data as unknown as SyncRpcResult;
}

async function pushAdjustWalletBalance(
  entry: Extract<OutboxOperation, { opType: "adjust_wallet_balance" }>,
  signal: AbortSignal,
): Promise<SyncRpcResult> {
  const { wallet_id, delta, reason } = entry.payload;
  const { data, error } = await supabase
    .rpc("adjust_wallet_balance", {
      p_operation_id: entry.operationId,
      p_wallet_id: wallet_id,
      p_delta: delta,
      p_reason: reason,
    })
    .abortSignal(signal);
  if (error) throw error;
  return data as unknown as SyncRpcResult;
}

async function pushAdjustProductStock(
  entry: Extract<OutboxOperation, { opType: "adjust_product_stock" }>,
  signal: AbortSignal,
): Promise<SyncRpcResult> {
  const { product_id, delta, reason } = entry.payload;
  const { data, error } = await supabase
    .rpc("adjust_product_stock", {
      p_operation_id: entry.operationId,
      p_product_id: product_id,
      p_delta: delta,
      p_reason: reason,
    })
    .abortSignal(signal);
  if (error) throw error;
  return data as unknown as SyncRpcResult;
}

async function pushVoidSale(
  entry: Extract<OutboxOperation, { opType: "void_sale" }>,
  signal: AbortSignal,
): Promise<SyncRpcResult> {
  const { sale_id, admin_id } = entry.payload;
  const { data, error } = await supabase
    .rpc("void_sale", {
      p_operation_id: entry.operationId,
      p_sale_id: sale_id,
      p_admin_id: admin_id,
    })
    .abortSignal(signal);
  if (error) throw error;
  return data as unknown as SyncRpcResult;
}

// The generic INSERT/UPDATE/DELETE path -- any table/feature with no
// dedicated RPC gets this for free (categories, products, student_wallets,
// profiles, shop_status admin CRUD). A "generic_delete" against
// products/categories is translated into a soft-delete UPDATE (deleted_at =
// now(), migration 00023) instead of an actual DELETE -- a hard delete would
// be invisible to another device's cursor-based pull, since there'd be no
// row left with a sync_seq to notice. The local Dexie effect at the call
// site is still a real db.<table>.delete(id) either way (see pull.ts's
// write-back: a pulled row with deleted_at set is removed locally, not
// stored as a visible tombstone), so every existing read call site keeps
// working unchanged -- "absent from Dexie" still means "deleted" throughout
// this app.
async function pushGenericMutation(
  entry: Extract<OutboxOperation, { opType: "generic_insert" | "generic_update" | "generic_delete" }>,
  signal: AbortSignal,
): Promise<QueueOutcome> {
  const { tableName, payload, opType } = entry;
  // tableName is an arbitrary runtime string, not a literal keyof
  // Database["public"]["Tables"] -- there's no static row shape to check
  // against here by design (this handler exists for actions/tables the
  // generated Database type doesn't need a dedicated RPC for). Same
  // `as never` escape hatch as the payload casts below -- never is a
  // subtype of every type, so it satisfies .from()'s narrow literal-union
  // parameter without lying about what supabase-js actually validates
  // (nothing, at the type level, past this boundary).
  const table = supabase.from(tableName as never);
  const { id } = payload;
  const softDeletable = tableName === "products" || tableName === "categories";

  const { error } =
    opType === "generic_insert"
      ? await table.insert(payload as never).abortSignal(signal)
      : opType === "generic_update"
        ? await table.update(payload as never).eq("id", id as never).abortSignal(signal)
        : softDeletable
          ? await table
              .update({ deleted_at: new Date().toISOString() } as never)
              .eq("id", id as never)
              .abortSignal(signal)
          : await table.delete().eq("id", id as never).abortSignal(signal);

  if (error) {
    if (
      error.code === CHECK_VIOLATION_CODE ||
      error.code === FOREIGN_KEY_VIOLATION_CODE ||
      error.code === UNIQUE_VIOLATION_CODE
    ) {
      return "conflict";
    }
    throw error;
  }
  return "completed";
}

// Attempts one network push for a single outbox entry and reconciles the
// outcome back onto its db.sync_outbox row. Used both for the eager
// immediately-after-commit attempt (services/sync callers) and for the
// periodic drain (drain.ts) -- same primitive either way, since a retry is
// just "call this again", safe by construction via the operationId ledger
// (or, for the generic path, by the underlying write being a plain
// idempotent field assignment).
export async function pushOutbox(entry: OutboxOperation): Promise<PushOutcome> {
  if (entry.id === undefined) {
    throw new Error("pushOutbox: entry has not been recorded to the outbox yet (missing id)");
  }
  const id = entry.id;

  // Known-offline (the last connectivity ping already confirmed it): don't
  // burn PUSH_TIMEOUT_MS on a call that's certain to fail -- leave the row
  // pending for the next reconnect-triggered drain.
  if (!getIsOnlineSnapshot()) return "queued";

  await db.sync_outbox.update(id, { status: "syncing" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);

  try {
    let outcome: PushOutcome;
    let conflictReason: string | undefined;

    switch (entry.opType) {
      case "complete_sale":
      case "adjust_wallet_balance":
      case "adjust_product_stock":
      case "void_sale": {
        const result =
          entry.opType === "complete_sale"
            ? await pushCompleteSale(entry, controller.signal)
            : entry.opType === "adjust_wallet_balance"
              ? await pushAdjustWalletBalance(entry, controller.signal)
              : entry.opType === "adjust_product_stock"
                ? await pushAdjustProductStock(entry, controller.signal)
                : await pushVoidSale(entry, controller.signal);
        outcome = result.outcome === "conflict" ? "conflict" : "synced";
        conflictReason = result.reason;
        break;
      }
      default: {
        const result = await pushGenericMutation(entry, controller.signal);
        outcome = result === "conflict" ? "conflict" : "synced";
        break;
      }
    }

    if (outcome === "conflict") {
      await db.sync_outbox.update(id, { status: "conflict", conflictReason, errorMessage: undefined });
      await logSyncEvent({
        eventType: `${entry.opType}_conflict`,
        severity: "warning",
        tableName: entry.tableName,
        operationId: entry.operationId,
        message: conflictReason ?? "conflict",
      });
    } else {
      await db.sync_outbox.update(id, { status: "synced", errorMessage: undefined, conflictReason: undefined });
    }

    return outcome;
  } catch (error) {
    const message = extractErrorMessage(error);
    await db.sync_outbox.update(id, {
      status: "error",
      retryCount: entry.retryCount + 1,
      errorMessage: message,
    });
    console.warn("[sync/push] push failed, will retry", entry.opType, entry.tableName, message);
    return "queued";
  } finally {
    clearTimeout(timer);
  }
}
