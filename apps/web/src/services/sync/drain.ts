import { db } from "@/lib/db";
import { pushOutbox } from "@/services/sync/push";
import type { OutboxOperation, PushOutcome } from "@/types/db";

// ============================================================================
// Drains the outbox -- replaces the old processSyncQueue(). Sequential, not
// Promise.all: one slow/failing item must never stop the rest from being
// attempted, same convention the old queue processor used.
//
// Every "pending"/"error" entry is attempted on every drain call, with no
// retry ceiling -- confirmed live in production that the old
// `retryCount >= MAX_RETRIES` skip left a cashier's sale permanently stuck
// after 5 failed attempts, silently requiring an admin to notice it in the
// Sync Health dashboard and click Retry. A genuine business conflict
// (deleted product, duplicate badge_code, ...) already exits this path
// entirely via the separate "conflict" outcome/status (see push.ts) and is
// never retried either way; an "error" status, by construction, is
// something that isn't a classified permanent failure, so there's no
// principled reason to ever stop trying it automatically. Reconnecting to
// the network (useSyncEngine's runSync, called on the offline->online
// transition, the 30s interval, and manual sync) is already the signal
// this needs -- MAX_RETRIES (outbox.ts) still marks an entry "stuck" for
// the admin dashboard's visibility, it just no longer gates retrying it.
// ============================================================================

export interface DrainSummary {
  // Sales specifically -- the sync badge's success toast reads "N sale(s)
  // saved" (i18n sync.toastSuccess), so it must not be conflated with a
  // product/category/wallet edit also having synced this cycle.
  syncedSales: number;
  conflicts: number;
}

export async function drainOutbox(): Promise<DrainSummary> {
  const candidates = await db.sync_outbox.where("status").anyOf(["pending", "error"]).toArray();
  let syncedSales = 0;
  let conflicts = 0;

  for (const entry of candidates) {
    if (entry.id === undefined) continue;

    const outcome = await pushOutbox(entry);
    if (outcome === "synced" && entry.opType === "complete_sale") syncedSales += 1;
    if (outcome === "conflict") conflicts += 1;
  }

  return { syncedSales, conflicts };
}

// Most-recent outbox entry (of any status) whose complete_sale payload
// references this sale id -- "most recent" matters because void_sale
// intentionally leaves a superseded/cancelled complete_sale entry in place
// (deleted, not overwritten -- see cancelPendingOutboxFor below) rather than
// mutating it, so there's normally at most one match anyway.
async function findOutboxEntryForSale(saleId: string): Promise<OutboxOperation | undefined> {
  const rows = await db.sync_outbox.toArray();
  return rows.find((item) => item.opType === "complete_sale" && item.payload.sale.id === saleId);
}

// On-demand, single-sale version of what drainOutbox does for one row --
// called when a caller (receipt sharing) needs a definitive synced/
// not-synced answer right now, not on the next ~30s cycle. Reusing
// pushOutbox directly is always safe even if this exact entry is mid-drain
// elsewhere, since complete_sale is idempotent via the operationId ledger.
export async function confirmSaleSynced(saleId: string): Promise<PushOutcome> {
  const entry = await findOutboxEntryForSale(saleId);
  if (!entry) {
    // No local outbox record for this sale at all -- either this device
    // never created one (a remotely-fetched receipt with no local Dexie
    // row, ReceiptPage's own case) or it predates the outbox entirely.
    // Callers only reach this function when they already know the sale
    // isn't sitting in an unresolved local state (see useShareReceipt.ts),
    // so "nothing to confirm" is equivalent to "already synced" here.
    return "synced";
  }
  if (entry.status === "synced") return "synced";
  if (entry.status === "conflict") return "conflict";
  return pushOutbox(entry);
}

// Deletes any not-yet-pushed outbox entry matching a predicate -- used when
// a sale gets voided/rejected before its original complete_sale push ever
// reached Supabase, so that superseded push can't still land later and
// re-apply an effect (re-decrementing stock, re-debiting a wallet) the
// caller has already reversed locally. Only removes entries still
// "pending"/"error" -- one already "syncing" is left alone (mid-flight,
// can't safely be cancelled from here) and one already "synced"/"conflict"
// is left for its own resolution path (the caller's compensating write,
// e.g. void_sale, accounts for an already-synced original separately).
export async function cancelPendingOutboxFor(predicate: (entry: OutboxOperation) => boolean): Promise<void> {
  const rows = await db.sync_outbox.where("status").anyOf(["pending", "error"]).toArray();
  for (const entry of rows) {
    if (entry.id !== undefined && predicate(entry)) {
      await db.sync_outbox.delete(entry.id);
    }
  }
}

export async function cancelPendingSalePush(saleId: string): Promise<void> {
  await cancelPendingOutboxFor((entry) => entry.opType === "complete_sale" && entry.payload.sale.id === saleId);
}
