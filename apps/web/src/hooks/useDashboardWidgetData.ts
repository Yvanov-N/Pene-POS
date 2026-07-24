import { useNetworkFirstQuery } from "@/hooks/useNetworkFirstQuery";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { mapProductRow, mapWalletRow, writeBackIfNewer } from "@/services/sync/pull";
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

async function fetchWalletsRemote(signal: AbortSignal) {
  const { data, error } = await supabase.from("student_wallets").select("*").abortSignal(signal);
  if (error) throw error;
  return data;
}
async function writeBackWallets(rows: Awaited<ReturnType<typeof fetchWalletsRemote>>) {
  await writeBackIfNewer(db.student_wallets, rows, mapWalletRow);
}

async function fetchProductsRemote(signal: AbortSignal) {
  // deleted_at is null: a soft-deleted product (migration 00023) must not
  // reappear in this stock-value widget -- the tombstone row only exists
  // for cursor-based pull propagation, it was never meant to be counted.
  const { data, error } = await supabase.from("products").select("*").is("deleted_at", null).abortSignal(signal);
  if (error) throw error;
  return data;
}
async function writeBackProducts(rows: Awaited<ReturnType<typeof fetchProductsRemote>>) {
  await writeBackIfNewer(db.products, rows, mapProductRow);
}

// "balance" isn't indexed in the Dexie schema -- DashboardPage's total-debt
// stat and CriticalDebtWidget's per-student list previously ran two
// independent db.student_wallets.toArray() scans even though both are
// mounted together on the same page. One shared live query backs both.
//
// Network-first: renders instantly from the Dexie cache (unchanged), with a
// background direct fetch refreshing it -- this is an admin-facing summary,
// so the same operationally-critical freshness that matters for the POS
// product grid applies here too (an admin reconciling debt wants current
// numbers, not whatever the last 30s poll happened to catch).
export function useStudentDebtSummary(): StudentDebtSummary | undefined {
  return useNetworkFirstQuery(
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
    { fetchRemote: fetchWalletsRemote, writeBack: writeBackWallets },
  );
}

// Current-state snapshot of stock on hand, priced at catalog value -- reads
// db.products directly (same table sales, restocking, and sync pulls all
// write to), so it rises/falls live with every one of those without any
// extra wiring.
export function useStockValueSummary(): number | undefined {
  return useNetworkFirstQuery(
    () => db.products.toArray().then((products) => products.reduce((sum, p) => sum + p.price * p.stock, 0)),
    [],
    { fetchRemote: fetchProductsRemote, writeBack: writeBackProducts },
  );
}
