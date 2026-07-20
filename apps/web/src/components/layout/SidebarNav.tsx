import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { useAdminLock } from "@/hooks/useAdminLock";
import { useShopStatus } from "@/hooks/useShopStatus";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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

const COLLAPSE_STORAGE_KEY = "pene-pos-sidebar-collapsed";

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
  const profile = useCurrentProfile();

  // Below md the rail is already icon-only by design (no room to spare) --
  // the manual collapse toggle only makes sense, and only renders, at md+.
  // isExpanded folds "wide enough to show labels" and "user chose to show
  // labels" into the one boolean everything else below reads, rather than
  // mixing a JS collapse state with a parallel set of Tailwind `md:`
  // prefixes that a manual override can't reach.
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  const isExpanded = isDesktop && !collapsed;

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  };

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
    <aside
      className={`flex h-screen shrink-0 flex-col overflow-y-auto border-r border-border bg-surface transition-[width] duration-200 ${
        isExpanded ? "w-64 p-4" : "w-16 p-2"
      }`}
    >
      <div className={`mb-4 flex items-center gap-2 ${isExpanded ? "justify-between" : "flex-col justify-center"}`}>
        <img src={logo} alt="Cité Shop" className="h-6 w-auto object-contain" />
        {isDesktop && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={isExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
            title={isExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
            className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-foreground"
          >
            {isExpanded ? "«" : "»"}
          </button>
        )}
      </div>

      {/* Responsive identity chip: avatar-only when collapsed (saves rail
          width), avatar + name + role badge when expanded. Clicking it is a
          quick link to Settings -- AdminRouteGuard already gates that route
          on its own, so this doesn't need to duplicate an "is admin
          unlocked" check. Sign-out is a separate adjacent icon button rather
          than a combined dropdown menu -- no floating-menu pattern exists
          anywhere else in this app, and two direct controls is simpler than
          building one. */}
      <div className="mb-3 flex items-center gap-1.5">
        <NavLink
          to="/admin/settings"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-surface2"
          title={profile?.full_name}
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface2 text-base"
              aria-hidden
            >
              👤
            </span>
          )}
          {isExpanded && (
            <span className="min-w-0 block">
              <span className="block truncate text-sm font-medium text-foreground">
                {profile?.full_name || t("sidebar.identityLoading")}
              </span>
              {profile && (
                <span className="block truncate text-xs text-muted">{t(`sidebar.roleBadge.${profile.role}`)}</span>
              )}
            </span>
          )}
        </NavLink>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          aria-label={t("sidebar.signOut")}
          title={t("sidebar.signOut")}
          className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-foreground"
        >
          🚪
        </button>
      </div>

      {isExpanded && (
        <div className="mb-3 flex items-center justify-between text-xs text-muted">
          <span>{lock.isAdminUnlocked ? t("sidebar.modeAdmin") : t("sidebar.modeCashier")}</span>
          <SyncStatusIndicator />
        </div>
      )}

      <button
        type="button"
        onClick={() => setShopTogglePending(true)}
        disabled={shopOpen === null}
        className={`mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface2 px-2 py-2 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50 ${
          isExpanded ? "justify-start" : "justify-center"
        }`}
        title={shopOpen ? t("sidebar.shopOpen") : t("sidebar.shopClosed")}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${shopOpen ? "bg-success" : "bg-muted"}`} aria-hidden />
        {isExpanded && <span>{shopOpen ? t("sidebar.shopOpen") : t("sidebar.shopClosed")}</span>}
      </button>

      {!!conflictCount && conflictCount > 0 && (
        <button
          type="button"
          onClick={() => setConflictsPinPending(true)}
          className={`badge-red mb-3 animate-pulse ${isExpanded ? "justify-start" : "justify-center"}`}
        >
          ⚠️ {isExpanded && <span>{t("admin.conflicts.badge", { count: conflictCount })}</span>}
        </button>
      )}

      <nav className="flex flex-col gap-1">
        {isExpanded && <p className="stat-label px-2.5">{t("sidebar.cashierZone")}</p>}
        {CASHIER_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === "/"} className={navLinkClass}>
            <span aria-hidden>{link.icon}</span>
            {isExpanded && <span>{t(link.labelKey)}</span>}
          </NavLink>
        ))}
      </nav>

      <nav className={`admin-nav mt-4 flex flex-col gap-1 ${lock.isAdminUnlocked ? "unlocked" : ""}`}>
        {isExpanded && (
          <p className="stat-label flex items-center gap-1 px-2.5">
            {!lock.isAdminUnlocked && (
              <span className="lock-icon" aria-hidden>
                🔒
              </span>
            )}
            {t("sidebar.adminZone")}
          </p>
        )}
        {ADMIN_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} className={navLinkClass}>
            <span aria-hidden>{link.icon}</span>
            {isExpanded && <span>{t(link.labelKey)}</span>}
          </NavLink>
        ))}
        {lock.isAdminUnlocked && (
          <button
            type="button"
            onClick={lock.manualLock}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface2 ${
              isExpanded ? "justify-start" : "justify-center"
            }`}
            aria-label={t("admin.nav.lockNow")}
          >
            <span aria-hidden>🔓</span>
            {isExpanded && <span>{t("admin.nav.lockNow")}</span>}
          </button>
        )}
      </nav>

      <div className={`mt-auto flex pt-3 ${isExpanded ? "justify-start" : "justify-center"}`}>
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
