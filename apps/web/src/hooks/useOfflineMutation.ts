import { useCallback } from "react";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import type { SyncAction } from "@/types/db";

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
    async (action: SyncAction, tableName: string, payload: Record<string, unknown>) => {
      await enqueueMutation(action, tableName, payload);
      void triggerManualSync();
    },
    [triggerManualSync],
  );

  return { mutate };
}
