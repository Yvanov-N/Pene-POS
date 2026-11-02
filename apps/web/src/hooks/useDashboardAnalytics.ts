import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { getRangeForFilter, type CustomRange, type TimeRangeFilter } from "@/lib/dateHelpers";
import { isRevenueRelevant, buildProductTotals, emptyProductTotals, type ProductTotals } from "@/lib/salesAggregation";
import type { OutboxOperation, PaymentMethod } from "@/types/db";
import { roundMoney } from "@/lib/money";

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

export interface ProductProfit {
  productId: string;
  name: string;
  quantitySold: number;
  revenue: number;
  cost: number;
  profit: number;
  // Over costed lines only; null when none of its lines has a known cost.
  marginPct: number | null;
  uncostedQuantity: number;
}

export interface DashboardAnalytics {
  grossRevenue: number;
  // Real profit = selling price - purchase cost snapshotted on each sale
  // line (sale_items.unit_cost). Lines with no known cost (sold before any
  // priced restock) are excluded and reported via uncostedRevenue.
  costOfGoods: number;
  grossProfit: number;
  marginPct: number | null;
  profitChangePct: number | null;
  uncostedRevenue: number;
  productProfitability: ProductProfit[];
  // null when the previous period had zero revenue to compare against --
  // any positive current revenue would otherwise read as a meaningless
  // "+Infinity%".
  revenueChangePct: number | null;
  totalTransactions: number;
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

async function sumRevenueForRange(start: string, end: string): Promise<number> {
  const sales = await db.sales.where("created_at").between(start, end, true, true).toArray();
  return sales.filter(isRevenueRelevant).reduce((sum, sale) => sum + sale.total_amount, 0);
}

async function sumProfitForRange(start: string, end: string): Promise<number> {
  const sales = await db.sales.where("created_at").between(start, end, true, true).toArray();
  const totals = await buildProductTotals(sales.filter(isRevenueRelevant).map((sale) => sale.id));
  let profit = 0;
  for (const bucket of totals.values()) profit += bucket.profit;
  return profit;
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function marginOf(totals: Pick<ProductTotals, "profit" | "costedRevenue">): number | null {
  return totals.costedRevenue > 0 ? Math.round((totals.profit / totals.costedRevenue) * 1000) / 10 : null;
}

// No dedicated recharge-history table exists anywhere (server or local) --
// db.sync_outbox is the durable local record of an adjust_wallet_balance
// mutation, since nothing prunes synced outbox entries. Filtered to
// reason === "recharge" specifically (StudentProfileDrawer tags every
// standalone wallet top-up this way) -- unlike the old sync_queue-based
// version of this query, a checkout wallet debit or a refund credit-back no
// longer produces a standalone outbox entry at all (complete_sale/void_sale
// apply those deltas atomically server-side now, bundled into the sale/
// refund's own single outbox entry), so this is now a clean top-ups-only
// total instead of a volume-of-all-adjustments figure that used to silently
// mix in negative checkout debits.
async function sumWalletRechargesForRange(start: string, end: string): Promise<number> {
  const items = await db.sync_outbox.where("createdAt").between(start, end, true, true).toArray();
  return items
    .filter(
      (item): item is Extract<OutboxOperation, { opType: "adjust_wallet_balance" }> =>
        item.opType === "adjust_wallet_balance" && item.payload.reason === "recharge",
    )
    .reduce((sum, item) => sum + (Number(item.payload.delta) || 0), 0);
}

export function useDashboardAnalytics(filter: TimeRangeFilter, customRange?: CustomRange): DashboardAnalytics {
  const { current, previous } = useMemo(() => getRangeForFilter(filter, customRange), [filter, customRange]);

  const result = useLiveQuery(async () => {
    const [sales, previousRevenue, previousProfit, totalWalletRecharges] = await Promise.all([
      db.sales.where("created_at").between(current.start, current.end, true, true).toArray(),
      sumRevenueForRange(previous.start, previous.end),
      sumProfitForRange(previous.start, previous.end),
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

    grossRevenue = roundMoney(grossRevenue);
    const totalTransactions = relevantSales.length;

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
        revenue: roundMoney(bucket?.revenue ?? 0),
        orders: bucket?.orders ?? 0,
      };
    });

    const paymentSplit: PaymentSplitEntry[] = PAYMENT_METHODS.map((method) => ({
      method,
      total: roundMoney(paymentTotals[method]),
      percentage: grossRevenue === 0 ? 0 : Math.round((paymentTotals[method] / grossRevenue) * 1000) / 10,
      fill: PAYMENT_COLORS[method],
    }));

    // "name" and "product_id" aren't in sale_items'/products' Dexie index
    // lists -- join and aggregate in memory rather than via indexed queries
    // (same reasoning as ProductManagementModal's in-memory name sort).
    const saleIds = relevantSales.map((sale) => sale.id);
    const productTotals = await buildProductTotals(saleIds);

    const entries = Array.from(productTotals.entries()).map(([productId, totals]) => ({ productId, ...totals }));
    const topEntries = [...entries].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // The profitability table lists every product sold in the range, so names
    // are needed for all of them (not just the top 5) -- still a bulkGet by
    // primary key rather than a full products scan.
    const productRows = await db.products.bulkGet(entries.map((entry) => entry.productId));
    const productNames = new Map(entries.map((entry, index) => [entry.productId, productRows[index]?.name ?? "Produit"]));

    const topProducts: TopProduct[] = topEntries.map((entry) => ({
      productId: entry.productId,
      name: productNames.get(entry.productId) ?? "Produit",
      quantitySold: entry.quantitySold,
      revenue: roundMoney(entry.revenue),
    }));

    const overall = emptyProductTotals();
    for (const entry of entries) {
      overall.revenue += entry.revenue;
      overall.costedRevenue += entry.costedRevenue;
      overall.cost += entry.cost;
      overall.profit += entry.profit;
    }

    const productProfitability: ProductProfit[] = entries
      .map((entry) => ({
        productId: entry.productId,
        name: productNames.get(entry.productId) ?? "Produit",
        quantitySold: entry.quantitySold,
        revenue: roundMoney(entry.revenue),
        cost: roundMoney(entry.cost),
        profit: roundMoney(entry.profit),
        marginPct: marginOf(entry),
        uncostedQuantity: entry.uncostedQuantity,
      }))
      .sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);

    return {
      grossRevenue,
      costOfGoods: roundMoney(overall.cost),
      grossProfit: roundMoney(overall.profit),
      marginPct: marginOf(overall),
      profitChangePct: changePct(overall.profit, previousProfit),
      uncostedRevenue: roundMoney(overall.revenue - overall.costedRevenue),
      productProfitability,
      revenueChangePct,
      totalTransactions,
      totalWalletRecharges: roundMoney(totalWalletRecharges),
      hourlyRevenue,
      paymentSplit,
      topProducts,
    };
  }, [current.start, current.end, previous.start, previous.end]);

  if (!result) {
    return {
      grossRevenue: 0,
      costOfGoods: 0,
      grossProfit: 0,
      marginPct: null,
      profitChangePct: null,
      uncostedRevenue: 0,
      productProfitability: [],
      revenueChangePct: null,
      totalTransactions: 0,
      totalWalletRecharges: 0,
      hourlyRevenue: emptyHourly(),
      paymentSplit: emptyPaymentSplit(),
      topProducts: [],
      isLoading: true,
    };
  }

  return { ...result, isLoading: false };
}
