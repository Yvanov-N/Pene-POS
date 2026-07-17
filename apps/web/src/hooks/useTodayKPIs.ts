import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { getTodayTimeRange } from "@/lib/dateHelpers";
import type { PaymentMethod, Sale } from "@/types/db";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];

export interface PaymentBreakdownEntry {
  count: number;
  total: number;
  percentage: number;
}

export interface TodayKPIs {
  grossRevenue: number;
  totalTransactions: number;
  averageCart: number;
  paymentBreakdown: Record<PaymentMethod, PaymentBreakdownEntry>;
  isLoading: boolean;
}

function emptyBreakdown(): Record<PaymentMethod, PaymentBreakdownEntry> {
  return {
    cash: { count: 0, total: 0, percentage: 0 },
    momo_mtn: { count: 0, total: 0, percentage: 0 },
    momo_orange: { count: 0, total: 0, percentage: 0 },
    student_wallet: { count: 0, total: 0, percentage: 0 },
  };
}

// XAF has no subunits (no cents), so summing whole-number total_amount
// values is exact -- no floating-point drift the way summing fractional
// currency would. Math.round() below is a defensive guard, not a fix for a
// real inaccuracy, in case a future feature ever introduces fractional
// pricing.
function aggregate(sales: Sale[]): Omit<TodayKPIs, "isLoading"> {
  const paymentBreakdown = emptyBreakdown();
  let grossRevenue = 0;

  for (const sale of sales) {
    grossRevenue += sale.total_amount;
    const bucket = paymentBreakdown[sale.payment_method];
    bucket.count += 1;
    bucket.total += sale.total_amount;
  }

  grossRevenue = Math.round(grossRevenue);
  const totalTransactions = sales.length;
  const averageCart = totalTransactions === 0 ? 0 : Math.round(grossRevenue / totalTransactions);

  for (const method of PAYMENT_METHODS) {
    const bucket = paymentBreakdown[method];
    bucket.total = Math.round(bucket.total);
    // One decimal place -- percentages read oddly as bare integers when a
    // breakdown genuinely lands on e.g. 33.3/33.3/33.3.
    bucket.percentage = grossRevenue === 0 ? 0 : Math.round((bucket.total / grossRevenue) * 1000) / 10;
  }

  return { grossRevenue, totalTransactions, averageCart, paymentBreakdown };
}

export function useTodayKPIs(): TodayKPIs {
  const result = useLiveQuery(async () => {
    const { start, end } = getTodayTimeRange();
    const todaysSales = await db.sales.where("created_at").between(start, end, true, true).toArray();

    const relevant = todaysSales.filter(
      (sale) =>
        (sale.status === "completed" || sale.status === "pending_sync") &&
        // A rejected MoMo sale had its stock restored by MoMoVerificationCard
        // (Phase 7.2) -- momo_verification_status is orthogonal to `status`
        // by design, so a rejected sale can still carry status "completed"/
        // "pending_sync" and would otherwise silently inflate today's
        // revenue for a transaction that was voided.
        sale.momo_verification_status !== "rejected",
    );

    return aggregate(relevant);
  }, []);

  if (!result) {
    return {
      grossRevenue: 0,
      totalTransactions: 0,
      averageCart: 0,
      paymentBreakdown: emptyBreakdown(),
      isLoading: true,
    };
  }

  return { ...result, isLoading: false };
}
