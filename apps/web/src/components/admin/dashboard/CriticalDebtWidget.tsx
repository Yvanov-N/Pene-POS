import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import type { StudentWallet } from "@/types/db";

function buildReminderMailto(wallet: StudentWallet, t: TFunction): string {
  const subject = t("admin.dashboard.debtReminderSubject");
  const body = t("admin.dashboard.debtReminderBody", {
    name: wallet.student_name,
    amount: formatCurrency(Math.abs(wallet.balance)),
  });
  return `mailto:${encodeURIComponent(wallet.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

interface CriticalDebtWidgetProps {
  // Sourced from the shared useStudentDebtSummary() hook (one scan of
  // student_wallets backing both this widget and DashboardPage's total-debt
  // stat) rather than this component fetching its own copy.
  debtors: StudentWallet[] | undefined;
}

export function CriticalDebtWidget({ debtors }: CriticalDebtWidgetProps) {
  const { t } = useTranslation();

  if (debtors !== undefined && debtors.length === 0) return null;

  return (
    <CardCustom
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          {t("admin.dashboard.criticalDebtTitle")}
        </span>
      }
      className="border-destructive"
    >
      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {debtors === undefined ? (
          <p className="text-sm text-muted">{t("admin.dashboard.loading")}</p>
        ) : (
          debtors.map((wallet) => (
            <div
              key={wallet.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive p-2 text-sm"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate font-medium text-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-destructive animate-pulse" aria-hidden />
                  {wallet.student_name}
                </p>
                <p className="text-xs text-muted">{wallet.badge_code}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge-red">{formatCurrency(wallet.balance)}</span>
                {wallet.email ? (
                  <a
                    href={buildReminderMailto(wallet, t)}
                    className="rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                  >
                    {t("admin.dashboard.contactStudent")}
                  </a>
                ) : (
                  <span
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted opacity-50"
                    title={t("admin.dashboard.noEmailOnFile")}
                  >
                    {t("admin.dashboard.contactStudent")}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </CardCustom>
  );
}
