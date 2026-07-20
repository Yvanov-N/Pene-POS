import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useAdminLock } from "@/hooks/useAdminLock";
import { useShopStatus } from "@/hooks/useShopStatus";
import { useToast } from "@/hooks/useToast";
import { PinPadModal } from "@/components/pos/PinPadModal";
import { SyncStatusIndicator } from "@/components/pos/SyncStatusIndicator";
import { LanguageSwitcher } from "@/components/pos/LanguageSwitcher";
import { AdminConflictDashboard } from "@/components/admin/AdminConflictDashboard";
import logo from "@/assets/logo.png";
import type { Profile } from "@/types/db";

const CASHIER_LINKS = [
  { to: "/", icon: "🛒", labelKey: "sidebar.pos" },
  { to: "/history", icon: "🧾", labelKey: "admin.nav.salesHistory" },
] as const;

const ADMIN_LINKS = [
  { to: "/admin/dashboard", icon: "📊", labelKey: "admin.nav.dashboard" },
  { to: "/admin/wallets", icon: "🎓", labelKey: "sidebar.wallets" },
  { to: "/admin/products", icon: "📦", labelKey: "admin.nav.products" },
  { to: "/admin/restocking", icon: "🔄", labelKey: "sidebar.restocking" },
  { to: "/admin/settings", icon: "⚙️", labelKey: "admin.nav.settings" },
] as const;

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-surface2"
  }`;

export function SidebarNav() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const lock = useAdminLock();

  const [conflictsPinPending, setConflictsPinPending] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [shopTogglePending, setShopTogglePending] = useState(false);
  const { shopOpen, toggleShopStatus } = useShopStatus();

  const conflictCount = useLiveQuery(
    () => db.sales.where("status").equals("conflict_warning").count(),
    [],
  );

  // No router existed when this was originally built for a push
  // notification's "open the conflicts view" click -- now that one does,
  // this still isn't a URL-routed deep link on purpose: the SW opens/focuses
  // the app at ?notification=conflicts as a query param regardless of which
  // route it lands on, and this just arms the (still PIN-gated) conflicts
  // flow instead of assuming any particular route is current.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("notification") === "conflicts") {
      setConflictsPinPending(true);
      params.delete("notification");
      const nextSearch = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (nextSearch ? `?${nextSearch}` : ""));
    }
  }, []);

  const handleShopToggleSuccess = async (profile: Profile) => {
    setShopTogglePending(false);
    const result = await toggleShopStatus(profile);
    if (!result.success) {
      showToast("error", t("sidebar.shopToggleError"));
      return;
    }
    showToast("success", result.nextOpen ? t("sidebar.shopOpenedToast") : t("sidebar.shopClosedToast"));
  };

  return (
    <aside className="flex h-screen w-16 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-2 md:w-64 md:p-4">
      <div className="mb-4 flex items-center justify-center gap-2 md:justify-start">
        <img src={logo} alt="Cité Shop" className="h-6 w-auto object-contain" />
      </div>

      <div className="mb-3 hidden items-center justify-between text-xs text-muted md:flex">
        <span>{lock.isAdminUnlocked ? t("sidebar.modeAdmin") : t("sidebar.modeCashier")}</span>
        <SyncStatusIndicator />
      </div>

      <button
        type="button"
        onClick={() => setShopTogglePending(true)}
        disabled={shopOpen === null}
        className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-border bg-surface2 px-2 py-2 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50 md:justify-start"
        title={shopOpen ? t("sidebar.shopOpen") : t("sidebar.shopClosed")}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${shopOpen ? "bg-success" : "bg-muted"}`} aria-hidden />
        <span className="hidden md:inline">{shopOpen ? t("sidebar.shopOpen") : t("sidebar.shopClosed")}</span>
      </button>

      {!!conflictCount && conflictCount > 0 && (
        <button
          type="button"
          onClick={() => setConflictsPinPending(true)}
          className="badge-red mb-3 animate-pulse justify-center md:justify-start"
        >
          ⚠️ <span className="hidden md:inline">{t("admin.conflicts.badge", { count: conflictCount })}</span>
        </button>
      )}

      <nav className="flex flex-col gap-1">
        <p className="stat-label hidden px-2.5 md:block">{t("sidebar.cashierZone")}</p>
        {CASHIER_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === "/"} className={navLinkClass}>
            <span aria-hidden>{link.icon}</span>
            <span className="hidden md:inline">{t(link.labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <nav className={`admin-nav mt-4 flex flex-col gap-1 ${lock.isAdminUnlocked ? "unlocked" : ""}`}>
        <p className="stat-label hidden items-center gap-1 px-2.5 md:flex">
          {!lock.isAdminUnlocked && (
            <span className="lock-icon" aria-hidden>
              🔒
            </span>
          )}
          {t("sidebar.adminZone")}
        </p>
        {ADMIN_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} className={navLinkClass}>
            <span aria-hidden>{link.icon}</span>
            <span className="hidden md:inline">{t(link.labelKey)}</span>
          </NavLink>
        ))}
        {lock.isAdminUnlocked && (
          <button
            type="button"
            onClick={lock.manualLock}
            className="flex items-center justify-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface2 md:justify-start"
            aria-label={t("admin.nav.lockNow")}
          >
            <span aria-hidden>🔓</span>
            <span className="hidden md:inline">{t("admin.nav.lockNow")}</span>
          </button>
        )}
      </nav>

      <div className="mt-auto flex justify-center pt-3 md:justify-start">
        <LanguageSwitcher />
      </div>

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

      {shopTogglePending && (
        <PinPadModal
          title={t("sidebar.shopTogglePinTitle")}
          requiredRole="admin"
          onSuccess={(profile) => void handleShopToggleSuccess(profile)}
          onClose={() => setShopTogglePending(false)}
        />
      )}
    </aside>
  );
}
