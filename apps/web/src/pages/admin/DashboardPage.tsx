import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, Receipt, GraduationCap, AlertTriangle, Package, TrendingUp, ShoppingBag, Download } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { downloadCsv } from "@/lib/csv";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { useStudentDebtSummary, useStockValueSummary, useWalletRechargesTotal } from "@/hooks/useDashboardWidgetData";
import { useShopStatus } from "@/hooks/useShopStatus";
import type { CustomRange, TimeRangeFilter } from "@/hooks/useDashboardAnalytics";
import { toLocalDateInput } from "@/lib/dateHelpers";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { StatCard } from "@/components/admin/StatCard";
import { RevenueAreaChart, PaymentDonutChart, TopSellersBarChart } from "@/components/admin/dashboard/AnalyticsCharts";
import {
  StockAlertWidget,
  ExpiryWarningWidget,
  SyncConflictStatusBar,
} from "@/components/admin/dashboard/OperationalWidgets";
import { CriticalDebtWidget } from "@/components/admin/dashboard/CriticalDebtWidget";
import { ProfitabilityTable } from "@/components/admin/dashboard/ProfitabilityTable";

const TIME_RANGE_FILTERS: TimeRangeFilter[] = ["today", "yesterday", "last7days", "last30days", "custom"];

function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={`stat-card animate-pulse${className ? ` ${className}` : ""}`}>
      <div className="h-3 w-24 rounded bg-surface2" />
      <div className="mt-3 h-8 w-32 rounded bg-surface2" />
      <div className="mt-2 h-3 w-28 rounded bg-surface2" />
    </div>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
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
  const totalWalletRecharges = useWalletRechargesTotal(analytics.range);
  const today = toLocalDateInput();

  // Opening "custom" with empty pickers would otherwise keep showing today's
  // figures under the "custom" label until both dates are picked.
  const selectRangeFilter = useCallback((option: TimeRangeFilter) => {
    setRangeFilter(option);
    if (option === "custom") {
      setCustomRange((current) => ({
        start: current.start || toLocalDateInput(),
        end: current.end || toLocalDateInput(),
      }));
    }
  }, []);

  // Current-state snapshot, not scoped to rangeFilter like the rest of
  // `analytics` -- total debt owed right now isn't a "how much happened this
  // week" metric, so it deliberately doesn't live inside useDashboardAnalytics.
  // One shared scan backs both this stat and CriticalDebtWidget below it.
  const debtSummary = useStudentDebtSummary();
  const totalStudentDebt = debtSummary?.totalDebt;

  // Same "current snapshot, not range-scoped" reasoning as totalStudentDebt
  // above -- stock on hand right now isn't a "how much happened this week"
  // metric either.
  const stockValue = useStockValueSummary();

  const handleExportCsv = useCallback(() => {
    const formatDay = (iso: string) => new Intl.DateTimeFormat(i18n.language).format(new Date(iso));
    const rangeLabel = `${t(`admin.dashboard.range.${rangeFilter}`)} (${formatDay(analytics.range.start)} → ${formatDay(analytics.range.end)})`;
    const rows: string[][] = [
      ["Cite Shop - Rapport tableau de bord"],
      ["Periode", rangeLabel],
      [],
      ["Indicateur", "Valeur"],
      [t("admin.dashboard.revenueLabel"), String(analytics.grossRevenue)],
      [t("admin.dashboard.costOfGoodsLabel"), String(analytics.costOfGoods)],
      [t("admin.dashboard.profitLabel"), String(analytics.grossProfit)],
      [t("admin.dashboard.marginLabel"), analytics.marginPct === null ? "" : `${analytics.marginPct}%`],
      [t("admin.dashboard.uncostedRevenueLabel"), String(analytics.uncostedRevenue)],
      [t("admin.dashboard.transactionsLabel"), String(analytics.totalTransactions)],
      [t("admin.dashboard.walletRechargesLabel"), String(totalWalletRecharges ?? 0)],
      [t("admin.dashboard.studentDebtLabel"), String(totalStudentDebt ?? 0)],
      [t("admin.dashboard.stockValueLabel"), String(stockValue?.retail ?? 0)],
      [t("admin.dashboard.stockValueAtCostLabel"), String(stockValue?.atCost ?? 0)],
      [],
      [
        t("admin.dashboard.exportTopProductsHeader"),
        t("admin.dashboard.profit.columnQuantity"),
        t("admin.dashboard.profit.columnRevenue"),
      ],
      ...analytics.topProducts.map((product) => [product.name, String(product.quantitySold), String(product.revenue)]),
      [],
      [
        t("admin.dashboard.profit.title"),
        t("admin.dashboard.profit.columnQuantity"),
        t("admin.dashboard.profit.columnRevenue"),
        t("admin.dashboard.profit.columnCost"),
        t("admin.dashboard.profit.columnProfit"),
        t("admin.dashboard.profit.columnMargin"),
      ],
      ...analytics.productProfitability.map((product) => [
        product.name,
        String(product.quantitySold),
        String(product.revenue),
        product.marginPct === null ? "" : String(product.cost),
        product.marginPct === null ? "" : String(product.profit),
        product.marginPct === null ? "" : `${product.marginPct}%`,
      ]),
    ];

    downloadCsv(`cite-shop-rapport-${toLocalDateInput()}.csv`, rows);
  }, [t, i18n.language, rangeFilter, analytics, totalWalletRecharges, totalStudentDebt, stockValue]);

  const revenueChangeNode: ReactNode = useMemo(() => {
    const pct = analytics.revenueChangePct;
    if (pct === null) return <span className="text-muted">{t("admin.dashboard.revenueChangeNew")}</span>;
    if (pct > 0) return <span className="text-success">+{pct}% {t("admin.dashboard.revenueChangeSuffix")}</span>;
    if (pct < 0) return <span className="text-destructive">{pct}% {t("admin.dashboard.revenueChangeSuffix")}</span>;
    return <span className="text-muted">0% {t("admin.dashboard.revenueChangeSuffix")}</span>;
  }, [analytics.revenueChangePct, t]);

  const profitSubNode: ReactNode = useMemo(() => {
    const pct = analytics.profitChangePct;
    const margin =
      analytics.marginPct === null ? null : t("admin.dashboard.marginSub", { pct: analytics.marginPct });
    const change =
      pct === null || pct === 0 ? null : (
        <span className={pct > 0 ? "text-success" : "text-destructive"}>
          {pct > 0 ? "+" : ""}
          {pct}% {t("admin.dashboard.revenueChangeSuffix")}
        </span>
      );
    return (
      <>
        {margin}
        {margin && change ? " · " : null}
        {change}
        {analytics.uncostedRevenue > 0 && (
          <span className="block">
            {t("admin.dashboard.uncostedRevenueNote", { amount: formatCurrency(analytics.uncostedRevenue) })}
          </span>
        )}
      </>
    );
  }, [analytics.profitChangePct, analytics.marginPct, analytics.uncostedRevenue, t]);

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
          <Download aria-hidden />
          {t("admin.dashboard.exportButton")}
        </ButtonCustom>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TIME_RANGE_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => selectRangeFilter(option)}
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
              max={today}
              onChange={(e) => setCustomRange((current) => ({ ...current, start: e.target.value }))}
              className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm text-foreground"
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              value={customRange.end}
              min={customRange.start || undefined}
              max={today}
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
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton className="md:col-span-2" />
          </>
        ) : (
          <>
            <StatCard
              icon={<Wallet className="h-6 w-6" />}
              label={t("admin.dashboard.revenueLabel")}
              value={analytics.grossRevenue}
              formatValue={formatCurrency}
              sub={revenueChangeNode}
            />
            <StatCard
              icon={<ShoppingBag className="h-6 w-6" />}
              label={t("admin.dashboard.costOfGoodsLabel")}
              value={analytics.costOfGoods}
              formatValue={formatCurrency}
              sub={t("admin.dashboard.costOfGoodsSub")}
            />
            <StatCard
              icon={<TrendingUp className="h-6 w-6" />}
              label={t("admin.dashboard.profitLabel")}
              value={analytics.grossProfit}
              formatValue={formatCurrency}
              valueClassName={analytics.grossProfit < 0 ? "text-destructive" : "text-success"}
              sub={profitSubNode}
            />
            <StatCard
              icon={<Receipt className="h-6 w-6" />}
              label={t("admin.dashboard.transactionsLabel")}
              value={analytics.totalTransactions}
              sub={t("admin.dashboard.transactionsSubRange")}
            />
            <StatCard
              icon={<Package className="h-6 w-6" />}
              label={t("admin.dashboard.stockValueLabel")}
              value={stockValue?.retail ?? 0}
              formatValue={formatCurrency}
              sub={
                <>
                  {t("admin.dashboard.stockValueAtCostSub", { amount: formatCurrency(stockValue?.atCost ?? 0) })}
                  {stockValue && stockValue.uncostedProducts > 0 && (
                    <span className="block">
                      {t("admin.dashboard.stockUncostedNote", { count: stockValue.uncostedProducts })}
                    </span>
                  )}
                </>
              }
            />
            <StatCard
              icon={<GraduationCap className="h-6 w-6" />}
              label={t("admin.dashboard.walletRechargesLabel")}
              value={totalWalletRecharges ?? 0}
              formatValue={formatCurrency}
              sub={t("admin.dashboard.walletRechargesSub")}
            />
            <StatCard
              icon={<AlertTriangle className="h-6 w-6" />}
              label={t("admin.dashboard.studentDebtLabel")}
              value={totalStudentDebt ?? 0}
              formatValue={formatCurrency}
              valueClassName="text-destructive"
              sub={t("admin.dashboard.studentDebtSub")}
              className="md:col-span-2"
            />
          </>
        )}
      </div>

      <CriticalDebtWidget debtors={debtSummary?.criticalDebtors} />

      <CardCustom title={t("admin.dashboard.profit.title")}>
        <ProfitabilityTable data={analytics.productProfitability} />
      </CardCustom>

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
