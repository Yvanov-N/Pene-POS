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
    void seedLocalCategories();
    void seedLocalProducts();
    void seedLocalProfiles();
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
