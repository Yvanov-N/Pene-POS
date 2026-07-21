import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { StudentWallet } from "@/types/db";

// Same "owing >= 5,000 FCFA" threshold as CriticalDebtWidget's own business
// rule -- a separate, stricter cutoff than "any debt at all" so the widget
// list stays a short, genuinely actionable list rather than flagging every
// few-hundred-FCFA rounding-edge overdraft.
const CRITICAL_DEBT_THRESHOLD = -5000;

export interface StudentDebtSummary {
  totalDebt: number;
  criticalDebtors: StudentWallet[];
}

// "balance" isn't indexed in the Dexie schema -- DashboardPage's total-debt
// stat and CriticalDebtWidget's per-student list previously ran two
// independent db.student_wallets.toArray() scans even though both are
// mounted together on the same page. One shared live query backs both.
export function useStudentDebtSummary(): StudentDebtSummary | undefined {
  return useLiveQuery(
    () =>
      db.student_wallets.toArray().then((wallets) => {
        const debtors = wallets.filter((w) => w.balance < 0);
        const totalDebt = debtors.reduce((sum, w) => sum + w.balance, 0);
        const criticalDebtors = wallets
          .filter((w) => w.balance <= CRITICAL_DEBT_THRESHOLD)
          .sort((a, b) => a.balance - b.balance);
        return { totalDebt, criticalDebtors };
      }),
    [],
  );
}

// Current-state snapshot of stock on hand, priced at catalog value -- reads
// db.products directly (same table sales, restocking, and sync pulls all
// write to), so it rises/falls live with every one of those without any
// extra wiring.
export function useStockValueSummary(): number | undefined {
  return useLiveQuery(
    () => db.products.toArray().then((products) => products.reduce((sum, p) => sum + p.price * p.stock, 0)),
    [],
  );
}
