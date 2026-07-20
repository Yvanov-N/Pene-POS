import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import type { StudentWallet } from "@/types/db";

// Same "owing >= 5,000 FCFA" threshold as the prompt's own business rule --
// a separate, stricter cutoff than "any debt at all" so this stays a short,
// genuinely actionable list rather than flagging every few-hundred-FCFA
// rounding-edge overdraft as a critical collections case.
const CRITICAL_DEBT_THRESHOLD = -5000;

function buildReminderMailto(wallet: StudentWallet, t: TFunction): string {
  const subject = t("admin.dashboard.debtReminderSubject");
  const body = t("admin.dashboard.debtReminderBody", {
    name: wallet.student_name,
    amount: formatCurrency(Math.abs(wallet.balance)),
  });
  return `mailto:${encodeURIComponent(wallet.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function CriticalDebtWidget() {
  const { t } = useTranslation();

  // "balance" isn't indexed in the Dexie schema -- same reasoning as
  // StockAlertWidget's in-memory filter/sort (a campus shop's wallet table
  // is small enough that this is cheap).
  const debtors = useLiveQuery(
    () =>
      db.student_wallets
        .toArray()
        .then((rows) => rows.filter((w) => w.balance <= CRITICAL_DEBT_THRESHOLD).sort((a, b) => a.balance - b.balance)),
    [],
  );

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
