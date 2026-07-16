import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { SyncStatusIndicator } from "./SyncStatusIndicator";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PinPadModal } from "./PinPadModal";
import { AdminConflictDashboard } from "@/components/admin/AdminConflictDashboard";
import { AdminSettingsModal } from "@/components/admin/AdminSettingsModal";
import { NavigationDrawer, type NavigationTarget } from "@/components/admin/NavigationDrawer";
import { ProductManagementModal } from "@/components/admin/ProductManagementModal";
import { StudentManagementModal } from "@/components/admin/StudentManagementModal";
import logo from "@/assets/logo.png";

type AdminModal = "conflicts" | "drawer" | NavigationTarget | null;

const PIN_TITLE_KEY = {
  conflicts: "admin.conflicts.pinTitle",
  drawer: "admin.nav.pinTitle",
  products: "admin.nav.pinTitle",
  students: "admin.nav.pinTitle",
  settings: "admin.settings.pinTitle",
} as const satisfies Record<Exclude<AdminModal, null>, string>;

export function TopBar() {
  const { t } = useTranslation();
  const [pendingModal, setPendingModal] = useState<AdminModal>(null);
  const [openModal, setOpenModal] = useState<AdminModal>(null);

  const conflictCount = useLiveQuery(
    () => db.sales.where("status").equals("conflict_warning").count(),
    [],
  );

  // No router exists, so a push notification's "open the conflicts view"
  // click can't be a URL-routed deep link -- the SW opens/focuses the app
  // at ?notification=conflicts, and this just opens the (still PIN-gated)
  // conflicts flow instead of the dashboard itself directly.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("notification") === "conflicts") {
      setPendingModal("conflicts");
      params.delete("notification");
      const nextSearch = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (nextSearch ? `?${nextSearch}` : ""));
    }
  }, []);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPendingModal("drawer")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface2 text-lg text-foreground hover:border-accent hover:bg-surface"
            aria-label={t("admin.nav.title")}
            title={t("admin.nav.title")}
          >
            ☰
          </button>
          <img src={logo} alt="Pene POS" className="h-6 object-contain w-auto" />
        </div>
        <div className="flex items-center gap-3">
          {!!conflictCount && conflictCount > 0 && (
            <button
              type="button"
              onClick={() => setPendingModal("conflicts")}
              className="badge-red animate-pulse"
            >
              ⚠️ {t("admin.conflicts.badge", { count: conflictCount })}
            </button>
          )}
          <SyncStatusIndicator />
          <LanguageSwitcher />
        </div>
      </div>

      {pendingModal && (
        <PinPadModal
          title={t(PIN_TITLE_KEY[pendingModal])}
          requiredRole="admin"
          onSuccess={() => {
            setOpenModal(pendingModal);
            setPendingModal(null);
          }}
          onClose={() => setPendingModal(null)}
        />
      )}

      {openModal === "conflicts" && <AdminConflictDashboard onClose={() => setOpenModal(null)} />}
      {openModal === "drawer" && (
        <NavigationDrawer onClose={() => setOpenModal(null)} onNavigate={(target) => setOpenModal(target)} />
      )}
      {openModal === "products" && <ProductManagementModal onClose={() => setOpenModal(null)} />}
      {openModal === "students" && <StudentManagementModal onClose={() => setOpenModal(null)} />}
      {openModal === "settings" && <AdminSettingsModal onClose={() => setOpenModal(null)} />}
    </>
  );
}
