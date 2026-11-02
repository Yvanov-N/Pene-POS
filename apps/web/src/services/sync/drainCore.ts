import { db } from "@/lib/db";
import type { OutboxOperation, PushOutcome } from "@/types/db";

const OUTBOX_DRAIN_LOCK = "pene-pos-outbox-drain";

export interface DrainSummary {
  // Sales specifically -- the sync badge's success toast reads "N sale(s)
  // saved" (i18n sync.toastSuccess), so it must not be conflated with a
  // product/category/wallet edit also having synced this cycle.
  syncedSales: number;
  conflicts: number;
}

// The drain loop itself, shared with the service worker's background sync
// (src/sw.ts), which passes its own push function. Serialised across the
// page and the worker with a Web Lock: two drains racing over the same
// entries would re-send generic inserts, which come back as unique-key
// "conflicts" instead of the replay-safe outcome the ledger RPCs give.
export async function drainOutboxWith(push: (entry: OutboxOperation) => Promise<PushOutcome>): Promise<DrainSummary> {
  const run = async (): Promise<DrainSummary> => {
    const candidates = await db.sync_outbox.where("status").anyOf(["pending", "error"]).toArray();
    let syncedSales = 0;
    let conflicts = 0;

    for (const entry of candidates) {
      if (entry.id === undefined) continue;

      const outcome = await push(entry);
      if (outcome === "synced" && entry.opType === "complete_sale") syncedSales += 1;
      if (outcome === "conflict") conflicts += 1;
    }

    return { syncedSales, conflicts };
  };

  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request(OUTBOX_DRAIN_LOCK, run);
  }
  return run();
}

