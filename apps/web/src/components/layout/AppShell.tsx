import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { CartProvider } from "@/hooks/useCart";
import { SyncProvider } from "@/hooks/useSyncEngine";
import { AdminLockProvider } from "@/hooks/useAdminLock";
import { ShopStatusProvider } from "@/hooks/useShopStatus";
import { seedLocalProducts } from "@/lib/seedLocalProducts";
import { seedLocalProfiles } from "@/lib/seedLocalProfiles";
import { seedLocalCategories } from "@/lib/seedLocalCategories";
import { SidebarNav } from "./SidebarNav";
import { AdminRouteGuard } from "./AdminRouteGuard";
import { PosLayout } from "@/components/pos/PosLayout";
import { SalesHistoryPage } from "@/pages/SalesHistoryPage";
import { DashboardPage } from "@/pages/admin/DashboardPage";
import { StudentWalletsPage } from "@/pages/admin/StudentWalletsPage";
import { ProductsPage } from "@/pages/admin/ProductsPage";
import { RestockingPage } from "@/pages/admin/RestockingPage";
import { SettingsPage } from "@/pages/admin/SettingsPage";

export function AppShell() {
  useEffect(() => {
    // DEV-ONLY. These seed a brand-new (empty) local Dexie table with fixed
    // mock rows so local testing has something to work with before the
    // first real pullAll() completes. This was unguarded for a long time --
    // running unconditionally on every device, including production, meant
    // a fresh production device could get seeded with rows that only ever
    // existed in the LOCAL dev Supabase project (fixed-id mock categories/
    // products) or, worse, a fake cashier profile with a random id that was
    // NEVER a real Supabase row (seedLocalProfiles.ts) -- any sale rung up
    // under that mock PIN was permanently unsyncable, confirmed live in
    // production (sales_cashier_id_fkey, never resolves since the id was
    // never going to become real). lib/db.ts's version 10 migration
    // (production-only) cleans up any already-poisoned device.
    if (import.meta.env.DEV) {
      void seedLocalCategories();
      void seedLocalProducts();
      void seedLocalProfiles();
    }
  }, []);

  return (
    <AdminLockProvider>
      <SyncProvider>
        <ShopStatusProvider>
          <CartProvider>
            {/* flex-col on mobile: SidebarNav renders a slim in-flow top bar
                there (not a fixed overlay), so it has to sit above <main> in
                the stack rather than beside it -- flex-row (side-by-side
                rail) only kicks in at md+, matching SidebarNav's own
                isDesktop breakpoint exactly. */}
            <div className="flex h-screen w-full flex-col bg-background text-foreground md:flex-row">
              <SidebarNav />
              <main className="min-w-0 flex-1 overflow-y-auto">
                <Routes>
                  <Route path="/" element={<PosLayout />} />
                  <Route path="/pos" element={<Navigate to="/" replace />} />
                  <Route path="/history" element={<SalesHistoryPage />} />
                  <Route
                    path="/admin/dashboard"
                    element={
                      <AdminRouteGuard>
                        <DashboardPage />
                      </AdminRouteGuard>
                    }
                  />
                  <Route
                    path="/admin/wallets"
                    element={
                      <AdminRouteGuard>
                        <StudentWalletsPage />
                      </AdminRouteGuard>
                    }
                  />
                  <Route
                    path="/admin/products"
                    element={
                      <AdminRouteGuard>
                        <ProductsPage />
                      </AdminRouteGuard>
                    }
                  />
                  <Route
                    path="/admin/restocking"
                    element={
                      <AdminRouteGuard>
                        <RestockingPage />
                      </AdminRouteGuard>
                    }
                  />
                  <Route
                    path="/admin/settings"
                    element={
                      <AdminRouteGuard>
                        <SettingsPage />
                      </AdminRouteGuard>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </main>
            </div>
          </CartProvider>
        </ShopStatusProvider>
      </SyncProvider>
    </AdminLockProvider>
  );
}
