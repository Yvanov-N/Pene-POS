import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/lib/currency";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { useShopStatus } from "@/hooks/useShopStatus";
import type { CustomRange, TimeRangeFilter } from "@/hooks/useDashboardAnalytics";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { StatCard } from "@/components/admin/StatCard";
import { RevenueAreaChart, PaymentDonutChart, TopSellersBarChart } from "@/components/admin/dashboard/AnalyticsCharts";
import {
  StockAlertWidget,
  ExpiryWarningWidget,
  SyncConflictStatusBar,
} from "@/components/admin/dashboard/OperationalWidgets";

const TIME_RANGE_FILTERS: TimeRangeFilter[] = ["today", "yesterday", "last7days", "last30days", "custom"];

function StatCardSkeleton() {
  return (
    <div className="stat-card animate-pulse">
      <div className="h-3 w-24 rounded bg-surface2" />
      <div className="mt-3 h-8 w-32 rounded bg-surface2" />
      <div className="mt-2 h-3 w-28 rounded bg-surface2" />
    </div>
  );
}

function csvField(value: string | number): string {
  const stringValue = String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [rangeFilter, setRangeFilter] = useState<TimeRangeFilter>("today");
  const [customRange, setCustomRange] = useState<CustomRange>({ start: "", end: "" });
  // Read-only display only here -- toggling shop status is SidebarNav's /
  // ShopStatusCard's job. Shares the ShopStatusProvider context (mounted
  // once in AppShell) rather than its own fetch, so this badge can't drift
  // out of sync with a toggle made from either of those -- the exact bug
  // this replaced (this page's own useState/useEffect kept showing the
  // status as of its own mount, missing any later toggle from elsewhere).
  const { shopOpen } = useShopStatus();

  const effectiveCustomRange = useMemo<CustomRange | undefined>(
    () => (rangeFilter === "custom" && customRange.start && customRange.end ? customRange : undefined),
    [rangeFilter, customRange],
  );

  const analytics = useDashboardAnalytics(rangeFilter, effectiveCustomRange);

  const handleExportCsv = () => {
    const rangeLabel = t(`admin.dashboard.range.${rangeFilter}`);
    const rows: string[][] = [
      ["Cite Shop - Rapport tableau de bord"],
      ["Periode", rangeLabel],
      [],
      ["Indicateur", "Valeur"],
      [t("admin.dashboard.revenueLabel"), String(analytics.grossRevenue)],
      [t("admin.dashboard.transactionsLabel"), String(analytics.totalTransactions)],
      [t("admin.dashboard.averageCartLabel"), String(analytics.averageCart)],
      [t("admin.dashboard.walletRechargesLabel"), String(analytics.totalWalletRecharges)],
      [],
      [t("admin.dashboard.exportTopProductsHeader"), "Quantite", "Chiffre d'affaires"],
      ...analytics.topProducts.map((product) => [product.name, String(product.quantitySold), String(product.revenue)]),
    ];

    const csv = rows.map((row) => row.map(csvField).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cite-shop-rapport-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const revenueChangeNode: ReactNode = (() => {
    const pct = analytics.revenueChangePct;
    if (pct === null) return <span className="text-muted">{t("admin.dashboard.revenueChangeNew")}</span>;
    if (pct > 0) return <span className="text-success">+{pct}% {t("admin.dashboard.revenueChangeSuffix")}</span>;
    if (pct < 0) return <span className="text-destructive">{pct}% {t("admin.dashboard.revenueChangeSuffix")}</span>;
    return <span className="text-muted">0% {t("admin.dashboard.revenueChangeSuffix")}</span>;
  })();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">{t("admin.nav.dashboard")}</h1>
          {shopOpen !== null && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className={`h-2 w-2 rounded-full ${shopOpen ? "bg-success" : "bg-muted"}`} aria-hidden />
              {shopOpen ? t("sidebar.shopOpen") : t("sidebar.shopClosed")}
            </span>
          )}
        </div>
        <ButtonCustom variant="primary" size="sm" onClick={handleExportCsv}>
          {t("admin.dashboard.exportButton")}
        </ButtonCustom>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TIME_RANGE_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setRangeFilter(option)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              rangeFilter === option
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface2 text-muted hover:text-foreground"
            }`}
          >
            {t(`admin.dashboard.range.${option}`)}
          </button>
        ))}
        {rangeFilter === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customRange.start}
              onChange={(e) => setCustomRange((current) => ({ ...current, start: e.target.value }))}
              className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm text-foreground"
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              value={customRange.end}
              onChange={(e) => setCustomRange((current) => ({ ...current, end: e.target.value }))}
              className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm text-foreground"
            />
          </div>
        )}
      </div>

      <div className="stat-grid">
        {analytics.isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              icon="💰"
              label={t("admin.dashboard.revenueLabel")}
              value={analytics.grossRevenue}
              formatValue={formatCurrency}
              sub={revenueChangeNode}
            />
            <StatCard
              icon="🧾"
              label={t("admin.dashboard.transactionsLabel")}
              value={analytics.totalTransactions}
              sub={t("admin.dashboard.transactionsSubRange")}
            />
            <StatCard
              icon="🛒"
              label={t("admin.dashboard.averageCartLabel")}
              value={analytics.averageCart}
              formatValue={formatCurrency}
              sub={t("admin.dashboard.averageCartSub")}
            />
            <StatCard
              icon="🎓"
              label={t("admin.dashboard.walletRechargesLabel")}
              value={analytics.totalWalletRecharges}
              formatValue={formatCurrency}
              sub={t("admin.dashboard.walletRechargesSub")}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardCustom title={t("admin.dashboard.revenueChartTitle")}>
          <RevenueAreaChart data={analytics.hourlyRevenue} />
        </CardCustom>
        <CardCustom title={t("admin.dashboard.paymentChartTitle")}>
          <PaymentDonutChart data={analytics.paymentSplit} />
        </CardCustom>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardCustom title={t("admin.dashboard.topSellersTitle")}>
          <TopSellersBarChart data={analytics.topProducts} />
        </CardCustom>
        <div className="flex flex-col gap-4">
          <StockAlertWidget />
          <ExpiryWarningWidget />
          <SyncConflictStatusBar />
        </div>
      </div>
    </div>
  );
}
