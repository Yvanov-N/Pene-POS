import type { Table } from "dexie";
import { db } from "@/lib/db";
import type { OutboxOperation, OutboxOpType, OutboxPayload } from "@/types/db";

// ============================================================================
// The local outbox -- one durable record per mutation, written in the SAME
// Dexie transaction as the business-table write it accompanies, before any
// network attempt. This is the fix for the "lost sale" root cause found in
// the old usePosCheckout.ts: that code awaited the network push BEFORE ever
// touching Dexie, so a tab closing mid-await lost the sale even if it had
// already landed server-side. Here, by the time commitLocal()/a caller's own
// db.transaction() resolves, the mutation is durable regardless of what
// happens to the network afterward -- the network push (services/sync/
// push.ts) is a separate, eager-but-not-load-bearing-for-durability step.
// ============================================================================

export const MAX_RETRIES = 5;

// operationId doubles as the idempotency key sent to the 4 ledger-guarded
// RPCs (public.sync_operations, migration 00024) and as the local
// correlation key for telemetry/UI -- generated once here, never
// regenerated on retry (a retry of the SAME outbox row reuses the SAME
// operationId, which is exactly what makes it a safe replay instead of a
// duplicate).
export function makeOutboxEntry<T extends OutboxOpType>(
  opType: T,
  tableName: string,
  payload: OutboxPayload,
): OutboxOperation {
  return {
    operationId: crypto.randomUUID(),
    opType,
    tableName,
    payload,
    status: "pending",
    retryCount: 0,
    createdAt: new Date().toISOString(),
  } as OutboxOperation;
}

// Inserts the entry and returns its assigned Dexie id (mutates entry.id too,
// so callers holding a reference can immediately pass the same object to
// pushOutbox()). Must be called from within an ambient db.transaction() that
// includes db.sync_outbox in its table list, alongside whatever business
// table(s) the caller is also writing to in that same transaction -- see
// commitLocal() below for the common single-table case, or checkout/refund/
// MoMo-reject for the multi-table cases that compose this directly.
export async function recordOutbox(entry: OutboxOperation): Promise<number> {
  const id = await db.sync_outbox.add(entry);
  entry.id = id;
  return id;
}

// Convenience for the majority of call sites (admin CRUD on a single table:
// product/category/profile/wallet field edits, shop_status toggle) -- wraps
// the local write and the outbox record in one transaction so the two can
// never diverge (a crash between two separate un-batched Dexie calls could
// otherwise leave a durably-applied local write with no corresponding
// outbox entry, silently dropping it from sync forever -- as bad as the
// lost-sale bug this module exists to fix). Multi-table writes (checkout,
// refund, category deletion cascading into product reassignment) don't fit
// this single-table shape and compose db.transaction()/recordOutbox()
// directly instead.
export async function commitLocal<T, TKey extends string | number>(
  table: Table<T, TKey>,
  // Promise<unknown>, not Promise<void> -- Dexie's put()/add()/update()
  // resolve with the primary key/row count, not void, so a call site
  // passing `() => db.products.put(saved)` directly (the common case) needs
  // the return value accepted, not just discarded via an explicit wrapper.
  localWrite: () => Promise<unknown>,
  entry: OutboxOperation,
): Promise<void> {
  await db.transaction("rw", table, db.sync_outbox, async () => {
    await localWrite();
    await recordOutbox(entry);
  });
}
