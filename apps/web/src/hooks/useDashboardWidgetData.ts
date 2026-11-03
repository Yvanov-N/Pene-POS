import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNetworkFirstQuery } from "@/hooks/useNetworkFirstQuery";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { roundMoney } from "@/lib/money";
import type { DateRange } from "@/lib/dateHelpers";
import { mapProductRow, writeBackActiveWallets, writeBackIfNewer } from "@/services/sync/pull";
import type { OutboxOperation, StudentWallet } from "@/types/db";

// Same "owing >= 5,000 FCFA" threshold as CriticalDebtWidget's own business
// rule -- a separate, stricter cutoff than "any debt at all" so the widget
// list stays a short, genuinely actionable list rather than flagging every
// few-hundred-FCFA rounding-edge overdraft.
const CRITICAL_DEBT_THRESHOLD = -5000;

export interface StudentDebtSummary {
  totalDebt: number;
  criticalDebtors: StudentWallet[];
}

// Archived wallets included on purpose: writeBackActiveWallets removes them
// locally, which also cleans up any an older build of this fetch resurrected.
async function fetchWalletsRemote(signal: AbortSignal) {
  const { data, error } = await supabase.from("student_wallets").select("*").abortSignal(signal);
  if (error) throw error;
  return data;
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
        return { totalDebt: roundMoney(totalDebt), criticalDebtors };
      }),
    [],
    { fetchRemote: fetchWalletsRemote, writeBack: writeBackActiveWallets },
  );
}

// Current-state snapshot of stock on hand, priced at catalog value -- reads
// db.products directly (same table sales, restocking, and sync pulls all
// write to), so it rises/falls live with every one of those without any
// extra wiring.
export interface StockValueSummary {
  // At selling price (catalogue value).
  retail: number;
  // At last purchase price, over products that have one.
  atCost: number;
  // Products in stock with no purchase price recorded yet.
  uncostedProducts: number;
}

export function useStockValueSummary(): StockValueSummary | undefined {
  return useNetworkFirstQuery(
    () =>
      db.products.toArray().then((products) => {
        const summary = products.reduce<StockValueSummary>(
          (acc, p) => {
            // Negative stock (oversell, migration 00019) has no value on hand
            // -- at either price, or it would subtract other products' value.
            const onHand = Math.max(0, p.stock);
            acc.retail += p.price * onHand;
            if (p.cost_price !== undefined) acc.atCost += p.cost_price * onHand;
            else if (onHand > 0) acc.uncostedProducts += 1;
            return acc;
          },
          { retail: 0, atCost: 0, uncostedProducts: 0 },
        );
        return { ...summary, retail: roundMoney(summary.retail), atCost: roundMoney(summary.atCost) };
      }),
    [],
    { fetchRemote: fetchProductsRemote, writeBack: writeBackProducts },
  );
}

// ---- Wallet recharges over a date range ----------------------------------
//
// Server-side ledger first: sync_operations (migration 00024) records every
// adjust_wallet_balance call from every device, which this device's own
// outbox can't -- it only holds the recharges rung up here. Local outbox
// entries the server doesn't list yet (not synced, or synced after the last
// fetch) are added on top, matched by operationId = sync_operations.id.
// Offline or on a failed fetch, the local outbox alone is the fallback.
//
// Known limit: sync_operations.created_at is when the server applied the
// operation, so a recharge made offline counts on the day it synced.

const RECHARGE_REFRESH_MS = 60_000;
const RECHARGE_PAGE_SIZE = 1000;

type RechargeOutboxEntry = Extract<OutboxOperation, { opType: "adjust_wallet_balance" }>;

async function fetchRechargesRemote(range: DateRange, signal: AbortSignal): Promise<Map<string, number>> {
  const recharges = new Map<string, number>();
  for (let from = 0; ; from += RECHARGE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("sync_operations")
      .select("id,result")
      .eq("op_type", "adjust_wallet_balance")
      .eq("outcome", "completed")
      .eq("result->>reason", "recharge")
      .gte("created_at", range.start)
      .lte("created_at", range.end)
      .order("created_at", { ascending: true })
      .range(from, from + RECHARGE_PAGE_SIZE - 1)
      .abortSignal(signal);
    if (error) throw error;
    for (const row of data) {
      const delta = (row.result as { delta?: unknown } | null)?.delta;
      if (typeof delta === "number") recharges.set(row.id, delta);
    }
    if (data.length < RECHARGE_PAGE_SIZE) return recharges;
  }
}

export function useWalletRechargesTotal(range: DateRange): number | undefined {
  // A conflict was refused by the server -- that recharge never happened.
  const localRecharges = useLiveQuery(
    () =>
      db.sync_outbox
        .where("createdAt")
        .between(range.start, range.end, true, true)
        .toArray()
        .then((items) =>
          items.filter(
            (item): item is RechargeOutboxEntry =>
              item.opType === "adjust_wallet_balance" && item.payload.reason === "recharge" && item.status !== "conflict",
          ),
        ),
    [range.start, range.end],
  );

  const [remote, setRemote] = useState<{ key: string; recharges: Map<string, number> } | null>(null);
  const rangeKey = `${range.start}|${range.end}`;
  // Refetch when a local recharge changes state (e.g. just synced), so the
  // server list catches up instead of the entry dropping out of the total.
  const localKey = localRecharges?.map((item) => `${item.operationId}:${item.status}`).join(",");

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (!navigator.onLine) return;
      fetchRechargesRemote(range, controller.signal)
        .then((recharges) => setRemote({ key: rangeKey, recharges }))
        .catch(() => {
          // Silent: the local outbox fallback below keeps rendering.
        });
    };
    load();
    const timer = setInterval(load, RECHARGE_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
    // range is fully described by rangeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, localKey]);

  if (localRecharges === undefined) return undefined;
  const serverRecharges = remote?.key === rangeKey ? remote.recharges : new Map<string, number>();
  let total = 0;
  for (const delta of serverRecharges.values()) total += delta;
  for (const item of localRecharges) {
    if (!serverRecharges.has(item.operationId)) total += Number(item.payload.delta) || 0;
  }
  return roundMoney(total);
}
