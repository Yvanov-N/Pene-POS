import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { getRangeForFilter, type CustomRange, type TimeRangeFilter } from "@/lib/dateHelpers";
import type { PaymentMethod, Sale } from "@/types/db";

export type { TimeRangeFilter, CustomRange };

export interface HourlyPoint {
  hour: string;
  revenue: number;
  orders: number;
}

export interface PaymentSplitEntry {
  method: PaymentMethod;
  total: number;
  percentage: number;
  fill: string;
}

export interface TopProduct {
  productId: string;
  name: string;
  quantitySold: number;
  revenue: number;
}

export interface DashboardAnalytics {
  grossRevenue: number;
  // null when the previous period had zero revenue to compare against --
  // any positive current revenue would otherwise read as a meaningless
  // "+Infinity%".
  revenueChangePct: number | null;
  totalTransactions: number;
  averageCart: number;
  totalWalletRecharges: number;
  hourlyRevenue: HourlyPoint[];
  paymentSplit: PaymentSplitEntry[];
  topProducts: TopProduct[];
  isLoading: boolean;
}

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];

// Same hues as PAYMENT_BADGE_CLASS (lib/paymentMethodStyles.ts) so a payment
// method reads as the same color everywhere in the app -- CSS custom
// properties work directly as SVG presentation-attribute values in modern
// browsers, so the donut/bar charts stay in sync with light/dark theming
// automatically instead of needing hardcoded hex duplicates.
const PAYMENT_COLORS: Record<PaymentMethod, string> = {
  cash: "hsl(var(--blue))",
  momo_mtn: "hsl(var(--amber))",
  momo_orange: "hsl(var(--orange))",
  student_wallet: "hsl(var(--green))",
};

function emptyHourly(): HourlyPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour: `${String(hour).padStart(2, "0")}h`, revenue: 0, orders: 0 }));
}

function emptyPaymentSplit(): PaymentSplitEntry[] {
  return PAYMENT_METHODS.map((method) => ({ method, total: 0, percentage: 0, fill: PAYMENT_COLORS[method] }));
}

// A rejected MoMo sale keeps status completed/pending_sync (rejection is
// tracked separately via momo_verification_status) and a refunded sale
// already carries its own distinct "refunded" status, so both are
// naturally excluded by this same check.
function isRevenueRelevant(sale: Sale): boolean {
  return (sale.status === "completed" || sale.status === "pending_sync") && sale.momo_verification_status !== "rejected";
}

async function sumRevenueForRange(start: string, end: string): Promise<number> {
  const sales = await db.sales.where("created_at").between(start, end, true, true).toArray();
  return sales.filter(isRevenueRelevant).reduce((sum, sale) => sum + sale.total_amount, 0);
}

// No dedicated recharge-history table exists anywhere (server or local) --
// sync_queue is the only durable record of a WALLET_RECHARGE mutation,
// since nothing prunes completed queue items. That necessarily also counts
// refund credits bounced back to a wallet (refundService.voidSale enqueues
// the exact same {action: "WALLET_RECHARGE", payload: {wallet_id, delta}}
// shape when reversing a student_wallet sale) -- there's no field
// distinguishing "new money loaded by an admin" from "money returned by a
// void", so this is a volume-of-adjustments figure, not a pure top-ups
// total. Flagged here rather than silently presented as more precise than
// the data actually supports.
async function sumWalletRechargesForRange(start: string, end: string): Promise<number> {
  const items = await db.sync_queue.where("created_at").between(start, end, true, true).toArray();
  return items
    .filter((item) => item.action === "WALLET_RECHARGE")
    .reduce((sum, item) => sum + (Number(item.payload.delta) || 0), 0);
}

export function useDashboardAnalytics(filter: TimeRangeFilter, customRange?: CustomRange): DashboardAnalytics {
  const { current, previous } = useMemo(() => getRangeForFilter(filter, customRange), [filter, customRange]);

  const result = useLiveQuery(async () => {
    const [sales, previousRevenue, totalWalletRecharges] = await Promise.all([
      db.sales.where("created_at").between(current.start, current.end, true, true).toArray(),
      sumRevenueForRange(previous.start, previous.end),
      sumWalletRechargesForRange(current.start, current.end),
    ]);

    const relevantSales = sales.filter(isRevenueRelevant);

    let grossRevenue = 0;
    const hourlyBuckets = new Map<number, { revenue: number; orders: number }>();
    const paymentTotals: Record<PaymentMethod, number> = { cash: 0, momo_mtn: 0, momo_orange: 0, student_wallet: 0 };

    for (const sale of relevantSales) {
      grossRevenue += sale.total_amount;
      paymentTotals[sale.payment_method] += sale.total_amount;

      // Bucketed by hour-of-day (not calendar day) so this stays a "when are
      // we busiest" rush-hour curve even when the selected range spans many
      // days (last7days/last30days/custom) rather than 24 near-empty bars.
      const hour = new Date(sale.created_at).getHours();
      const bucket = hourlyBuckets.get(hour) ?? { revenue: 0, orders: 0 };
      bucket.revenue += sale.total_amount;
      bucket.orders += 1;
      hourlyBuckets.set(hour, bucket);
    }

    grossRevenue = Math.round(grossRevenue);
    const totalTransactions = relevantSales.length;
    const averageCart = totalTransactions === 0 ? 0 : Math.round(grossRevenue / totalTransactions);

    const revenueChangePct =
      previousRevenue === 0
        ? grossRevenue === 0
          ? 0
          : null
        : Math.round(((grossRevenue - previousRevenue) / previousRevenue) * 1000) / 10;

    const hourlyRevenue: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => {
      const bucket = hourlyBuckets.get(hour);
      return {
        hour: `${String(hour).padStart(2, "0")}h`,
        revenue: Math.round(bucket?.revenue ?? 0),
        orders: bucket?.orders ?? 0,
      };
    });

    const paymentSplit: PaymentSplitEntry[] = PAYMENT_METHODS.map((method) => ({
      method,
      total: Math.round(paymentTotals[method]),
      percentage: grossRevenue === 0 ? 0 : Math.round((paymentTotals[method] / grossRevenue) * 1000) / 10,
      fill: PAYMENT_COLORS[method],
    }));

    // "name" and "product_id" aren't in sale_items'/products' Dexie index
    // lists -- join and aggregate in memory rather than via indexed queries
    // (same reasoning as ProductManagementModal's in-memory name sort).
    const saleIds = relevantSales.map((sale) => sale.id);
    const items = saleIds.length > 0 ? await db.sale_items.where("sale_id").anyOf(saleIds).toArray() : [];
    const products = await db.products.toArray();
    const productNames = new Map(products.map((product) => [product.id, product.name]));

    const productTotals = new Map<string, { quantitySold: number; revenue: number }>();
    for (const item of items) {
      const bucket = productTotals.get(item.product_id) ?? { quantitySold: 0, revenue: 0 };
      bucket.quantitySold += item.quantity;
      bucket.revenue += item.quantity * item.unit_price;
      productTotals.set(item.product_id, bucket);
    }

    const topProducts: TopProduct[] = Array.from(productTotals.entries())
      .map(([productId, totals]) => ({
        productId,
        name: productNames.get(productId) ?? "Produit",
        quantitySold: totals.quantitySold,
        revenue: Math.round(totals.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      grossRevenue,
      revenueChangePct,
      totalTransactions,
      averageCart,
      totalWalletRecharges: Math.round(totalWalletRecharges),
      hourlyRevenue,
      paymentSplit,
      topProducts,
    };
  }, [current.start, current.end, previous.start, previous.end]);

  if (!result) {
    return {
      grossRevenue: 0,
      revenueChangePct: null,
      totalTransactions: 0,
      averageCart: 0,
      totalWalletRecharges: 0,
      hourlyRevenue: emptyHourly(),
      paymentSplit: emptyPaymentSplit(),
      topProducts: [],
      isLoading: true,
    };
  }

  return { ...result, isLoading: false };
}
