import { getIsOnlineSnapshot, NETWORK_FIRST_TIMEOUT_MS } from "@/lib/networkStatusStore";
import { pushGeneric, pushSale, pushWalletBalanceAdjustment, type QueueOutcome } from "@/services/syncService";
import type { GenericMutationPayload, SalePayload, WalletBalancePayload } from "@/types/db";

// Network-first write orchestration -- see syncService.ts's repository-
// pattern note (step 3) for how this fits into the rest of the app. Every
// write call site attempts the direct Supabase primitive first (racing
// NETWORK_FIRST_TIMEOUT_MS) and only falls back to the local-first
// Dexie-txn + enqueueMutation path this app has always used when that
// attempt doesn't land -- known-offline, timed out, or genuinely failed.
export type WriteMode = "cloud" | "local";

async function networkFirstWrite<P>(
  payload: P,
  cloudPush: (payload: P, signal: AbortSignal) => Promise<QueueOutcome>,
): Promise<WriteMode> {
  // Known-offline (the last ping already confirmed it): don't waste
  // NETWORK_FIRST_TIMEOUT_MS racing a call that's certain to fail -- go
  // straight to the caller's local fallback.
  if (!getIsOnlineSnapshot()) return "local";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_FIRST_TIMEOUT_MS);
  try {
    const outcome = await cloudPush(payload, controller.signal);
    // A real conflict (FK/unique violation -- stock/wallet CHECK violations
    // are no longer possible as of migration 00019) is treated the same as
    // a failure: fall back to the local write + enqueue, and let the
    // deferred queue processor rediscover and classify it via the existing
    // conflict_warning machinery on its next cycle, instead of a second
    // "instant conflict" UI path for a case that's now rare.
    return outcome === "conflict" ? "local" : "cloud";
  } catch (error) {
    console.warn("[repository] direct write failed, falling back to local queue", error);
    return "local";
  } finally {
    clearTimeout(timer);
  }
}

export function submitSaleNetworkFirst(payload: SalePayload): Promise<WriteMode> {
  return networkFirstWrite(payload, pushSale);
}

export function submitWalletAdjustmentNetworkFirst(payload: WalletBalancePayload): Promise<WriteMode> {
  return networkFirstWrite(payload, pushWalletBalanceAdjustment);
}

export function submitGenericMutationNetworkFirst(
  action: "INSERT" | "UPDATE" | "DELETE",
  tableName: string,
  payload: GenericMutationPayload,
): Promise<WriteMode> {
  return networkFirstWrite(payload, (p, signal) => pushGeneric(action, tableName, p, signal));
}
