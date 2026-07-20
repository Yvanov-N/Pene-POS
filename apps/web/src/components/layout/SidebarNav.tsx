import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import {
  LayoutDashboard,
  ShoppingCart,
  History,
  Users,
  Box,
  RefreshCw,
  Settings,
  LogOut,
  Lock,
  Unlock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  CircleUserRound,
} from "lucide-react";
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
import { ConditionalTooltip } from "@/components/ui/tooltip";
import logo from "@/assets/logo.png";
import type { Profile } from "@/types/db";

// Deliberately `as const`, not a `NavLinkConfig[]` annotation -- i18next's
// typed `t()` only accepts literal key strings, and widening labelKey to
// `string` (as an explicit interface would) breaks that checking for every
// call site below.
const CASHIER_LINKS = [
  { to: "/", icon: ShoppingCart, labelKey: "sidebar.pos" },
  { to: "/history", icon: History, labelKey: "admin.nav.salesHistory" },
] as const;

const ADMIN_LINKS = [
  { to: "/admin/dashboard", icon: LayoutDashboard, labelKey: "admin.nav.dashboard" },
  { to: "/admin/wallets", icon: Users, labelKey: "sidebar.wallets" },
  { to: "/admin/products", icon: Box, labelKey: "admin.nav.products" },
  { to: "/admin/restocking", icon: RefreshCw, labelKey: "sidebar.restocking" },
  { to: "/admin/settings", icon: Settings, labelKey: "admin.nav.settings" },
] as const;

const COLLAPSE_STORAGE_KEY = "pene-pos-sidebar-collapsed";

// Collapsed nav rows render as a centered icon-only column
// (flex-col items-center justify-center) instead of the expanded row
// (icon + label, left-aligned) -- the two layouts are different enough
// (direction, alignment, padding) that one shared class string with a
// couple of conditionals reads clearer as two literal variants.
function navLinkClass(isExpanded: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    `flex rounded-lg text-sm font-medium transition-colors ${
      isExpanded ? "items-center gap-3 px-2.5 py-2" : "w-full flex-col items-center justify-center gap-0.5 px-1 py-2"
    } ${isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-surface2"}`;
}

interface SidebarBodyProps {
  isExpanded: boolean;
  // Only set by the mobile drawer -- clicking a link inside it should also
  // close the drawer, which the desktop rail has no equivalent of.
  onNavigate?: () => void;
  profile: Profile | undefined;
  isAdminUnlocked: boolean;
  onManualLock: () => void;
  conflictCount: number | undefined;
  onConflictsClick: () => void;
  shopOpen: boolean | null;
  onShopToggleClick: () => void;
  onSignOut: () => void;
}

// The full nav rail's contents, factored out so the desktop <aside> and the
// mobile slide-over drawer render byte-identical markup (just at different
// widths/isExpanded values) instead of maintaining two copies. Kept as a
// real top-level component (not a closure defined inside SidebarNav) so it
// doesn't remount on every SidebarNav re-render.
function SidebarBody({
  isExpanded,
  onNavigate,
  profile,
  isAdminUnlocked,
  onManualLock,
  conflictCount,
  onConflictsClick,
  shopOpen,
  onShopToggleClick,
  onSignOut,
}: SidebarBodyProps) {
  const { t } = useTranslation();
  const linkClass = navLinkClass(isExpanded);
  const collapsed = !isExpanded;

  return (
    <>
      {/* Identity chip: avatar-only when collapsed, avatar + name + role
          badge when expanded. Sign-out sits directly below it (never
          beside) once collapsed -- nothing is allowed to sit side-by-side
          in a narrow icon rail. */}
      <div className={`mb-3 flex ${isExpanded ? "items-center gap-1.5" : "flex-col items-center gap-2"}`}>
        <ConditionalTooltip show={collapsed} label={profile?.full_name ?? t("sidebar.identityLoading")}>
          <NavLink
            to="/admin/settings"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-surface2"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            ) : (
              <CircleUserRound className="h-8 w-8 shrink-0 text-muted" aria-hidden />
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
        </ConditionalTooltip>
        <ConditionalTooltip show={collapsed} label={t("sidebar.signOut")}>
          <button
            type="button"
            onClick={onSignOut}
            aria-label={t("sidebar.signOut")}
            className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </ConditionalTooltip>
      </div>

      {/* Connectivity/sync state stays visible even collapsed (compact mode
          falls back to just the icon) -- it's important enough that it
          shouldn't disappear behind the expand toggle the way the plain
          "Mode admin/caissier" label can. */}
      <div className={`mb-3 flex items-center text-xs text-muted ${isExpanded ? "justify-between" : "justify-center"}`}>
        {isExpanded && <span>{isAdminUnlocked ? t("sidebar.modeAdmin") : t("sidebar.modeCashier")}</span>}
        <SyncStatusIndicator compact={!isExpanded} onErrorClick={onConflictsClick} />
      </div>

      <ConditionalTooltip show={collapsed} label={shopOpen ? t("sidebar.shopOpen") : t("sidebar.shopClosed")}>
        <button
          type="button"
          onClick={onShopToggleClick}
          disabled={shopOpen === null}
          className={`mb-3 flex w-full items-center gap-2 rounded-lg border border-border bg-surface2 px-2 py-2 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50 ${
            isExpanded ? "justify-start" : "justify-center"
          }`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${shopOpen ? "bg-success" : "bg-muted"}`} aria-hidden />
          {isExpanded && <span>{shopOpen ? t("sidebar.shopOpen") : t("sidebar.shopClosed")}</span>}
        </button>
      </ConditionalTooltip>

      {!!conflictCount && conflictCount > 0 && (
        <ConditionalTooltip show={collapsed} label={t("admin.conflicts.badge", { count: conflictCount })}>
          <button
            type="button"
            onClick={onConflictsClick}
            className={`badge-red mb-3 w-full animate-pulse gap-1.5 ${isExpanded ? "justify-start" : "justify-center"}`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {isExpanded && <span>{t("admin.conflicts.badge", { count: conflictCount })}</span>}
          </button>
        </ConditionalTooltip>
      )}

      <nav className="flex flex-col gap-1">
        {isExpanded && <p className="stat-label px-2.5">{t("sidebar.cashierZone")}</p>}
        {CASHIER_LINKS.map((link) => (
          <ConditionalTooltip key={link.to} show={collapsed} label={t(link.labelKey)}>
            <NavLink to={link.to} end={link.to === "/"} onClick={onNavigate} className={linkClass}>
              <link.icon className="h-5 w-5 shrink-0" aria-hidden />
              {isExpanded && <span>{t(link.labelKey)}</span>}
            </NavLink>
          </ConditionalTooltip>
        ))}
      </nav>

      <nav className={`admin-nav mt-4 flex flex-col gap-1 ${isAdminUnlocked ? "unlocked" : ""}`}>
        {isExpanded && (
          <p className="stat-label flex items-center gap-1 px-2.5">
            {!isAdminUnlocked && <Lock className="lock-icon h-3 w-3" aria-hidden />}
            {t("sidebar.adminZone")}
          </p>
        )}
        {ADMIN_LINKS.map((link) => (
          <ConditionalTooltip key={link.to} show={collapsed} label={t(link.labelKey)}>
            <NavLink to={link.to} onClick={onNavigate} className={linkClass}>
              <link.icon className="h-5 w-5 shrink-0" aria-hidden />
              {isExpanded && <span>{t(link.labelKey)}</span>}
            </NavLink>
          </ConditionalTooltip>
        ))}
        {isAdminUnlocked && (
          <ConditionalTooltip show={collapsed} label={t("admin.nav.lockNow")}>
            <button
              type="button"
              onClick={onManualLock}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface2 ${
                isExpanded ? "justify-start" : "w-full flex-col justify-center gap-0.5 px-1"
              }`}
              aria-label={t("admin.nav.lockNow")}
            >
              <Unlock className="h-4 w-4 shrink-0" aria-hidden />
              {isExpanded && <span>{t("admin.nav.lockNow")}</span>}
            </button>
          </ConditionalTooltip>
        )}
      </nav>

      <div className={`mt-auto flex pt-3 ${isExpanded ? "justify-start" : "justify-center"}`}>
        <LanguageSwitcher stacked={collapsed} />
      </div>
    </>
  );
}

export function SidebarNav() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const lock = useAdminLock();

  const [conflictsPinPending, setConflictsPinPending] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [shopTogglePending, setShopTogglePending] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { shopOpen, toggleShopStatus } = useShopStatus();
  const profile = useCurrentProfile();

  // Below md there's no persistent rail at all (see the mobile branch below)
  // -- the manual collapse toggle only makes sense, and only renders, at
  // md+. isExpanded folds "wide enough to show labels" and "user chose to
  // show labels" into the one boolean everything else below reads, rather
  // than mixing a JS collapse state with a parallel set of Tailwind `md:`
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

  const sharedBodyProps = {
    profile,
    isAdminUnlocked: lock.isAdminUnlocked,
    onManualLock: lock.manualLock,
    conflictCount,
    onConflictsClick: () => setConflictsPinPending(true),
    shopOpen,
    onShopToggleClick: () => setShopTogglePending(true),
    onSignOut: () => void supabase.auth.signOut(),
  };

  return (
    <>
      {isDesktop ? (
        <aside
          className={`flex h-screen shrink-0 flex-col overflow-y-auto border-r border-border bg-surface transition-[width] duration-300 ease-in-out ${
            isExpanded ? "w-64 p-4" : "w-16 p-2"
          }`}
        >
          <div className={`mb-4 flex items-center gap-2 ${isExpanded ? "justify-between" : "flex-col justify-center"}`}>
            <img src={logo} alt="Cité Shop" className="h-6 w-auto object-contain" />
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={isExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
              className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-foreground"
            >
              {isExpanded ? <ChevronLeft className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
            </button>
          </div>

          <SidebarBody isExpanded={isExpanded} {...sharedBodyProps} />
        </aside>
      ) : (
        <>
          {/* Mobile/tablet: no persistent rail at all -- a slim top bar
              (in normal flow, not floating, so it can never overlap a
              page's own top content like the POS barcode input) plus a
              hamburger trigger that opens the identical nav content as a
              full slide-over drawer. */}
          <header className="flex h-14 w-full shrink-0 items-center justify-between border-b border-border bg-surface px-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label={t("sidebar.openMenu")}
              className="rounded-lg p-2 text-foreground hover:bg-surface2"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <img src={logo} alt="Cité Shop" className="h-6 w-auto object-contain" />
            <div className="flex items-center gap-2">
              <SyncStatusIndicator compact onErrorClick={() => setConflictsPinPending(true)} />
              <NavLink to="/admin/settings" aria-label={t("admin.nav.settings")}>
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <CircleUserRound className="h-7 w-7 text-muted" aria-hidden />
                )}
              </NavLink>
            </div>
          </header>

          {mobileOpen && (
            <div className="fixed inset-0 z-50 flex">
              <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
              <div className="relative flex h-full w-72 max-w-[80vw] flex-col overflow-y-auto border-r border-border bg-surface p-4 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <img src={logo} alt="Cité Shop" className="h-6 w-auto object-contain" />
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    aria-label={t("sidebar.closeMenu")}
                    className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-foreground"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <SidebarBody isExpanded onNavigate={() => setMobileOpen(false)} {...sharedBodyProps} />
              </div>
            </div>
          )}
        </>
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

      {shopTogglePending && (
        <PinPadModal
          title={t("sidebar.shopTogglePinTitle")}
          requiredRole="admin"
          onSuccess={(profile) => void handleShopToggleSuccess(profile)}
          onClose={() => setShopTogglePending(false)}
        />
      )}
    </>
  );
}
