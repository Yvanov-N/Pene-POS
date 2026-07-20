import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/db";

export interface ToggleShopStatusResult {
  success: boolean;
  nextOpen: boolean;
}

interface ShopStatusContextValue {
  shopOpen: boolean | null;
  toggleShopStatus: (profile: Profile) => Promise<ToggleShopStatusResult>;
}

// A plain per-component useState/useEffect here (as this used to be) gives
// every mounted consumer its own independent copy of shopOpen -- SidebarNav
// is mounted on every route, so toggling from e.g. Settings' ShopStatusCard
// would flip the DB row but leave the sidebar's own badge showing the old
// value until a full reload. A Context provider, mounted once in AppShell,
// is this codebase's established fix for exactly this shape of problem
// (ToastContext/CartContext/AdminLockContext/SyncEngineContext all do the
// same thing for their own piece of shared state).
const ShopStatusContext = createContext<ShopStatusContextValue | null>(null);

export function ShopStatusProvider({ children }: { children: ReactNode }) {
  const [shopOpen, setShopOpen] = useState<boolean | null>(null);

  useEffect(() => {
    void supabase
      .from("shop_status")
      .select("is_open")
      .eq("id", 1)
      .single()
      .then(({ data }) => setShopOpen(data?.is_open ?? null));
  }, []);

  // Only updates shop_status -- the shop_status_notify Postgres trigger
  // (migration 00003) already POSTs to the notify-shop-status edge function
  // on every UPDATE to this row, via pg_net, regardless of which client
  // made the change. Calling the edge function directly here too would
  // double-send the broadcast email to every student wallet.
  const toggleShopStatus = async (profile: Profile): Promise<ToggleShopStatusResult> => {
    const nextOpen = !shopOpen;
    const { error } = await supabase
      .from("shop_status")
      .update({ is_open: nextOpen, updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) return { success: false, nextOpen };
    setShopOpen(nextOpen);
    return { success: true, nextOpen };
  };

  return (
    <ShopStatusContext.Provider value={{ shopOpen, toggleShopStatus }}>{children}</ShopStatusContext.Provider>
  );
}

export function useShopStatus(): ShopStatusContextValue {
  const context = useContext(ShopStatusContext);
  if (!context) {
    throw new Error("useShopStatus must be used within a ShopStatusProvider");
  }
  return context;
}
