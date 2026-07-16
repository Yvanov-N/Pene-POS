import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { SyncStatusIndicator } from "./SyncStatusIndicator";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PinPadModal } from "./PinPadModal";
import { AdminConflictDashboard } from "@/components/admin/AdminConflictDashboard";
import { AdminSettingsModal } from "@/components/admin/AdminSettingsModal";
import logo from "@/assets/logo.png";

type AdminModal = "conflicts" | "settings" | null;

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
        <img src={logo} alt="Pene POS" className="h-6 object-contain w-auto" />
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
          <button
            type="button"
            onClick={() => setPendingModal("settings")}
            className="text-muted hover:text-foreground"
            aria-label={t("admin.settings.title")}
            title={t("admin.settings.title")}
          >
            ⚙️
          </button>
          <SyncStatusIndicator />
          <LanguageSwitcher />
        </div>
      </div>

      {pendingModal && (
        <PinPadModal
          title={pendingModal === "conflicts" ? t("admin.conflicts.pinTitle") : t("admin.settings.pinTitle")}
          requiredRole="admin"
          onSuccess={() => {
            setOpenModal(pendingModal);
            setPendingModal(null);
          }}
          onClose={() => setPendingModal(null)}
        />
      )}

      {openModal === "conflicts" && <AdminConflictDashboard onClose={() => setOpenModal(null)} />}
      {openModal === "settings" && <AdminSettingsModal onClose={() => setOpenModal(null)} />}
    </>
  );
}
