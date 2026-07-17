import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useAdminLock } from "@/hooks/useAdminLock";
import { SyncStatusIndicator } from "./SyncStatusIndicator";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PinPadModal } from "./PinPadModal";
import { AdminConflictDashboard } from "@/components/admin/AdminConflictDashboard";
import { AdminSettingsModal } from "@/components/admin/AdminSettingsModal";
import { ProductManagementModal } from "@/components/admin/ProductManagementModal";
import { StudentManagementModal } from "@/components/admin/StudentManagementModal";
import { StudentWalletRechargeCard } from "@/components/admin/StudentWalletRechargeCard";
import { MoMoVerificationCard } from "@/components/admin/MoMoVerificationCard";
import logo from "@/assets/logo.png";

// "dashboard" has no screen yet -- the KPI analytics dashboard is explicitly
// deferred (Phase 8), so its nav item renders visibly but disabled rather
// than being silently omitted or wired to something that doesn't exist.
type AdminView = "dashboard" | "stocks" | "students" | "settings" | "recharge" | "momo";

const ADMIN_NAV_ITEMS = [
  { view: "dashboard", labelKey: "admin.nav.dashboard", disabled: true },
  { view: "stocks", labelKey: "admin.nav.products", disabled: false },
  { view: "students", labelKey: "admin.nav.students", disabled: false },
  { view: "recharge", labelKey: "admin.nav.recharge", disabled: false },
  { view: "momo", labelKey: "admin.nav.momo", disabled: false },
  { view: "settings", labelKey: "admin.nav.settings", disabled: false },
] as const satisfies { view: AdminView; labelKey: string; disabled: boolean }[];

export function TopBar() {
  const { t } = useTranslation();
  const lock = useAdminLock();

  // Conflicts keeps its own, separate always-re-prompt PIN gate (an alert,
  // not "navigation") -- untouched by the new session-based admin lock.
  const [conflictsPinPending, setConflictsPinPending] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);

  // The 4 admin-nav tabs share the new session lock: once unlocked, clicking
  // any of them opens directly; while locked, a click arms the PIN gate and
  // only opens after a successful admin PIN unlocks the whole session.
  const [pendingView, setPendingView] = useState<AdminView | null>(null);
  const [openView, setOpenView] = useState<AdminView | null>(null);

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
      setConflictsPinPending(true);
      params.delete("notification");
      const nextSearch = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (nextSearch ? `?${nextSearch}` : ""));
    }
  }, []);

  const handleNavClick = (view: AdminView) => {
    if (lock.isAdminUnlocked) {
      setOpenView(view);
    } else {
      setPendingView(view);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Pene POS" className="h-6 object-contain w-auto" />

          <nav className={`admin-nav flex items-center gap-1 ${lock.isAdminUnlocked ? "unlocked" : ""}`}>
            {!lock.isAdminUnlocked && (
              <span className="lock-icon text-sm" aria-hidden>
                🔒
              </span>
            )}
            {ADMIN_NAV_ITEMS.map((item) => (
              <button
                key={item.view}
                type="button"
                disabled={item.disabled}
                title={item.disabled ? t("admin.nav.comingSoon") : undefined}
                onClick={() => handleNavClick(item.view)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface2 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {t(item.labelKey)}
              </button>
            ))}
            {lock.isAdminUnlocked && (
              <button
                type="button"
                onClick={lock.manualLock}
                className="rounded-lg px-2 py-1.5 text-sm hover:bg-surface2"
                aria-label={t("admin.nav.lockNow")}
                title={t("admin.nav.lockNow")}
              >
                🔓
              </button>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {!!conflictCount && conflictCount > 0 && (
            <button
              type="button"
              onClick={() => setConflictsPinPending(true)}
              className="badge-red animate-pulse"
            >
              ⚠️ {t("admin.conflicts.badge", { count: conflictCount })}
            </button>
          )}
          <SyncStatusIndicator />
          <LanguageSwitcher />
        </div>
      </div>

      {pendingView && (
        <PinPadModal
          title={t("admin.nav.pinTitle")}
          requiredRole="admin"
          onSuccess={() => {
            lock.unlock();
            setOpenView(pendingView);
            setPendingView(null);
          }}
          onClose={() => setPendingView(null)}
        />
      )}

      {conflictsPinPending && (
        <PinPadModal
          title={t("admin.conflicts.pinTitle")}
          requiredRole="admin"
          onSuccess={() => {
            setConflictsOpen(true);
            setConflictsPinPending(false);
          }}
          onClose={() => setConflictsPinPending(false)}
        />
      )}

      {conflictsOpen && <AdminConflictDashboard onClose={() => setConflictsOpen(false)} />}
      {openView === "stocks" && <ProductManagementModal onClose={() => setOpenView(null)} />}
      {openView === "students" && <StudentManagementModal onClose={() => setOpenView(null)} />}
      {openView === "recharge" && <StudentWalletRechargeCard onClose={() => setOpenView(null)} />}
      {openView === "momo" && <MoMoVerificationCard onClose={() => setOpenView(null)} />}
      {openView === "settings" && <AdminSettingsModal onClose={() => setOpenView(null)} />}
    </>
  );
}
