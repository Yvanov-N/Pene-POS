import { useTranslation } from "react-i18next";
import { useTodayKPIs } from "@/hooks/useTodayKPIs";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { StatCard } from "./StatCard";

interface KpiDashboardProps {
  onClose: () => void;
}

function StatCardSkeleton() {
  return (
    <div className="stat-card animate-pulse">
      <div className="h-3 w-24 rounded bg-surface2" />
      <div className="mt-3 h-8 w-32 rounded bg-surface2" />
      <div className="mt-2 h-3 w-28 rounded bg-surface2" />
    </div>
  );
}

export function KpiDashboard({ onClose }: KpiDashboardProps) {
  const { t } = useTranslation();
  const kpis = useTodayKPIs();

  const cashPct = Math.round(kpis.paymentBreakdown.cash.percentage);
  const momoPct = Math.round(
    kpis.paymentBreakdown.momo_mtn.percentage + kpis.paymentBreakdown.momo_orange.percentage,
  );
  const walletBreakdown = kpis.paymentBreakdown.student_wallet;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <CardCustom
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-y-auto"
        title={t("admin.nav.dashboard")}
        header={
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            ✕
          </button>
        }
      >
        <div className="stat-grid">
          {kpis.isLoading ? (
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
                value={kpis.grossRevenue}
                formatValue={formatCurrency}
                sub={t("admin.dashboard.revenueSub", { cash: cashPct, momo: momoPct })}
              />
              <StatCard
                icon="🧾"
                label={t("admin.dashboard.transactionsLabel")}
                value={kpis.totalTransactions}
                sub={t("admin.dashboard.transactionsSub")}
              />
              <StatCard
                icon="🛒"
                label={t("admin.dashboard.averageCartLabel")}
                value={kpis.averageCart}
                formatValue={formatCurrency}
                sub={t("admin.dashboard.averageCartSub")}
              />
              <StatCard
                icon="🎓"
                label={t("admin.dashboard.walletLabel")}
                value={walletBreakdown.total}
                formatValue={formatCurrency}
                sub={t("admin.dashboard.walletSub", { count: walletBreakdown.count })}
              />
            </>
          )}
        </div>
      </CardCustom>
    </div>
  );
}
