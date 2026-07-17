import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { CartProvider } from "@/hooks/useCart";
import { SyncProvider } from "@/hooks/useSyncEngine";
import { AdminLockProvider } from "@/hooks/useAdminLock";
import { seedLocalProducts } from "@/lib/seedLocalProducts";
import { seedLocalProfiles } from "@/lib/seedLocalProfiles";
import { SidebarNav } from "./SidebarNav";
import { AdminRouteGuard } from "./AdminRouteGuard";
import { PosLayout } from "@/components/pos/PosLayout";
import { SalesHistoryCard } from "@/components/admin/SalesHistoryCard";
import { KpiDashboard } from "@/components/admin/KpiDashboard";
import { AdminWalletsPage } from "@/pages/AdminWalletsPage";
import { ProductManagementModal } from "@/components/admin/ProductManagementModal";
import { RestockingPlaceholderPage } from "@/pages/RestockingPlaceholderPage";
import { AdminSettingsModal } from "@/components/admin/AdminSettingsModal";

export function AppShell() {
  useEffect(() => {
    void seedLocalProducts();
    void seedLocalProfiles();
  }, []);

  return (
    <AdminLockProvider>
      <SyncProvider>
        <CartProvider>
          <div className="flex h-screen w-full bg-background text-foreground">
            <SidebarNav />
            <main className="min-w-0 flex-1 overflow-y-auto">
              <Routes>
                <Route path="/" element={<PosLayout />} />
                <Route path="/pos" element={<Navigate to="/" replace />} />
                <Route path="/history" element={<SalesHistoryCard />} />
                <Route
                  path="/admin/dashboard"
                  element={
                    <AdminRouteGuard>
                      <KpiDashboard />
                    </AdminRouteGuard>
                  }
                />
                <Route
                  path="/admin/wallets"
                  element={
                    <AdminRouteGuard>
                      <AdminWalletsPage />
                    </AdminRouteGuard>
                  }
                />
                <Route
                  path="/admin/products"
                  element={
                    <AdminRouteGuard>
                      <ProductManagementModal />
                    </AdminRouteGuard>
                  }
                />
                <Route
                  path="/admin/restocking"
                  element={
                    <AdminRouteGuard>
                      <RestockingPlaceholderPage />
                    </AdminRouteGuard>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <AdminRouteGuard>
                      <AdminSettingsModal />
                    </AdminRouteGuard>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </CartProvider>
      </SyncProvider>
    </AdminLockProvider>
  );
}
