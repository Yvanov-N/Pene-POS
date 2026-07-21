import { useCallback } from "react";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import type { GenericMutationPayload, SalePayload, SyncAction, WalletBalancePayload } from "@/types/db";

// Mirrors enqueueMutation's own overloads (syncService.ts) so a payload
// mismatched to its action is a compile error here too, not just inside
// syncService.ts.
type MutateFn = {
  (action: "SALE", tableName: string, payload: SalePayload): Promise<void>;
  (action: "WALLET_RECHARGE" | "WALLET_WITHDRAWAL", tableName: string, payload: WalletBalancePayload): Promise<void>;
  (action: "INSERT" | "UPDATE" | "DELETE", tableName: string, payload: GenericMutationPayload): Promise<void>;
};

// Thin convenience wrapper around the two calls every write handler in this
// app already makes back to back -- enqueueMutation() then
// triggerManualSync() -- so a new feature can plug into the offline queue in
// one line instead of remembering both. See the repository-pattern doc
// comment at the top of services/syncService.ts for the full 3-step rule
// (Dexie schema -> useLiveQuery reads -> local write + this call).
//
// This does NOT replace the local Dexie write itself -- that part is always
// table-specific (a `put`, an `update` with particular fields, sometimes
// inside a db.transaction(...) for a multi-table atomic op like checkout),
// so it stays explicit at the call site rather than being hidden in here.
// Usage:
//   await db.products.update(id, { stock: nextStock });
//   await mutate("UPDATE", "products", { id, stock: nextStock });
export function useOfflineMutation() {
  const { triggerManualSync } = useSyncEngine();

  const mutate = useCallback(
    // enqueueMutation's overloads guarantee correctness at every call site of
    // `mutate` below; this cast is the one place that can't be statically
    // correlated (action and payload are independently widened here), same
    // pattern as syncService.ts's own `payload as never` at its generic push
    // boundary.
    (async (
      action: SyncAction,
      tableName: string,
      payload: SalePayload | WalletBalancePayload | GenericMutationPayload,
    ) => {
      await enqueueMutation(action as never, tableName, payload as never);
      void triggerManualSync();
    }) as MutateFn,
    [triggerManualSync],
  );

  return { mutate };
}
