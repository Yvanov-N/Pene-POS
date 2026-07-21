import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import type { Profile } from "@/types/db";

export interface ToggleShopStatusResult {
  success: boolean;
  nextOpen: boolean;
}

interface ShopStatusContextValue {
  shopOpen: boolean | null;
  toggleShopStatus: (profile: Profile) => Promise<ToggleShopStatusResult>;
}

// Shared by SidebarNav's quick-access toggle and Settings' ShopStatusCard --
// both need the same current-status read and the same toggle mutation, not
// two independent copies of this async/stateful logic.
const ShopStatusContext = createContext<ShopStatusContextValue | null>(null);

export function ShopStatusProvider({ children }: { children: ReactNode }) {
  const { triggerManualSync } = useSyncEngine();

  // Phase 12 offline-first audit: this used to be a plain useState fetched
  // once via a direct supabase.from("shop_status") call -- the one hook in
  // the app that read AND wrote straight against Supabase with no local
  // Dexie mirror, meaning it simply didn't work at all while offline (the
  // toggle button would just fail, and the status would never even load on
  // first paint without a live connection). useLiveQuery against the new
  // shop_status Dexie table (lib/db.ts version 7) means every mounted
  // consumer renders instantly from local storage and reacts automatically
  // to either this device's own toggle or a pulled change from another
  // device, exactly like every other table in the app.
  const status = useLiveQuery(() => db.shop_status.get(1), []);
  const shopOpen = status?.is_open ?? null;

  // Only enqueues a shop_status UPDATE -- the shop_status_notify Postgres
  // trigger (migration 00003) already POSTs to the notify-shop-status edge
  // function on every UPDATE to this row, via pg_net, regardless of which
  // client (or how many sync retries) eventually applies it. Calling the
  // edge function directly here too would double-send the broadcast email
  // to every student wallet.
  const toggleShopStatus = useCallback(
    async (profile: Profile): Promise<ToggleShopStatusResult> => {
      // shopOpen is only null before this device's first successful pull --
      // toggling from an unknown current value isn't well-defined, so this is
      // disabled at the call site too (ShopStatusCard/SidebarNav already
      // disable the button while shopOpen === null).
      if (shopOpen === null) return { success: false, nextOpen: true };

      const nextOpen = !shopOpen;
      const now = new Date().toISOString();

      try {
        // put(), not update(): guarantees a full, valid row even in the
        // (should-be-impossible-per-the-guard-above, but defensive anyway)
        // case where the local row is somehow missing -- update() on a
        // nonexistent key is a silent no-op in Dexie, not an error.
        await db.shop_status.put({ id: 1, is_open: nextOpen, updated_by: profile.id, updated_at: now });
        await enqueueMutation("UPDATE", "shop_status", {
          id: 1,
          is_open: nextOpen,
          updated_by: profile.id,
          updated_at: now,
        });
        void triggerManualSync();
        return { success: true, nextOpen };
      } catch (error) {
        console.error("[useShopStatus] local write failed", error);
        return { success: false, nextOpen };
      }
    },
    [shopOpen, triggerManualSync],
  );

  const value = useMemo<ShopStatusContextValue>(
    () => ({ shopOpen, toggleShopStatus }),
    [shopOpen, toggleShopStatus],
  );

  return <ShopStatusContext.Provider value={value}>{children}</ShopStatusContext.Provider>;
}

export function useShopStatus(): ShopStatusContextValue {
  const context = useContext(ShopStatusContext);
  if (!context) {
    throw new Error("useShopStatus must be used within a ShopStatusProvider");
  }
  return context;
}
