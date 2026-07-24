import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { MAX_RETRIES } from "@/services/sync/outbox";
import type { OutboxOperation } from "@/types/db";

// ============================================================================
// Admin-facing sync health: stuck outbox items (needs a human) plus recent
// negative-stock/negative-balance events (informational, no action needed).
//
// This is deliberately much smaller than the old conflictResolver.ts's
// SALE-specific listConflicts/resolveByAdjustingStock/
// resolveByAcceptingNegativeStock trio. Those existed to resolve a stock
// oversell caught as a check_violation -- but migration 00019 already
// removed the constraint that used to raise it, and this rebuild confirmed
// via a live smoke test that a concurrent oversell now always returns
// `outcome: "completed"` with `negative_stock: true`, never a conflict.
// There is no longer a stock-oversell conflict shape to build a per-product
// resolution UI around; the surviving conflict causes (a deleted product a
// still-offline sale referenced, a duplicate badge_code, an unauthorized or
// already-refunded void) have no product-aware "adjust to X" remedy -- retry
// (assume transient) or dismiss (give up, stop it blocking the sync badge)
// covers all of them uniformly, same as the old dashboard's "other stuck
// items" section already did for non-SALE items.
// ============================================================================

export interface StuckOutboxItem {
  id: number;
  tableName: string;
  opType: string;
  status: "conflict" | "error";
  retryCount: number;
  errorMessage?: string;
  conflictReason?: string;
  createdAt: string;
}

export async function listStuckItems(): Promise<StuckOutboxItem[]> {
  const all = await db.sync_outbox.toArray();
  return all
    .filter((item): item is OutboxOperation & { id: number } => {
      if (item.id === undefined) return false;
      if (item.status === "conflict") return true;
      return item.status === "error" && item.retryCount >= (item.maxRetries ?? MAX_RETRIES);
    })
    .map((item) => ({
      id: item.id,
      tableName: item.tableName,
      opType: item.opType,
      status: item.status as "conflict" | "error",
      retryCount: item.retryCount,
      errorMessage: item.errorMessage,
      conflictReason: item.conflictReason,
      createdAt: item.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Gives a transient failure another chance (a real Supabase hiccup, not a
// structural conflict) -- resets to "pending" so the next sync cycle
// attempts it fresh, same retry budget as any other item from here.
export async function retryStuckItem(id: number): Promise<void> {
  await db.sync_outbox.update(id, {
    status: "pending",
    retryCount: 0,
    errorMessage: undefined,
    conflictReason: undefined,
  });
}

// Gives up on this one mutation without retrying it further -- marks it
// "synced" (not deleted) purely so it drops out of the stuck-items list and
// the sync badge's error count; the underlying local write it accompanied
// is untouched either way; this only affects whether the push is attempted
// again.
export async function dismissStuckItem(id: number): Promise<void> {
  await db.sync_outbox.update(id, { status: "synced", errorMessage: undefined, conflictReason: undefined });
}

export interface RecentSyncEvent {
  eventType: string;
  severity: string;
  entityTable: string | null;
  entityId: string | null;
  message: string | null;
  occurredAt: string;
}

// Live read, not local -- sync_events is admin-only (RLS, migration 00025)
// and exists specifically to show what's happened across every device, not
// just this one's local outbox, so there's no local Dexie mirror to read
// instead. Same "deliberate exception to the offline-first read rule" as
// the old conflictResolver.ts's live stock read.
export async function listRecentSyncEvents(limit = 20): Promise<RecentSyncEvent[]> {
  const { data, error } = await supabase
    .from("sync_events")
    .select("event_type,severity,entity_table,entity_id,message,occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[sync/conflicts] failed to fetch recent sync events", error);
    return [];
  }

  return data.map((row) => ({
    eventType: row.event_type,
    severity: row.severity,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    message: row.message,
    occurredAt: row.occurred_at,
  }));
}
