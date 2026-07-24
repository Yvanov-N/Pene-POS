import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { commitLocal, makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { drainOutbox } from "@/services/sync/drain";
import type { Sale, SaleItem } from "@/types/db";

// Dev-console verification utility (window.__TEST_OFFLINE_SYNC__, wired up
// in main.tsx behind import.meta.env.DEV -- this deliberately never ships in
// a production build). A real network drop can't actually be triggered from
// page JS (navigator.onLine is read-only, reflecting real OS/network state)
// -- for a literal test, open DevTools > Network > Offline (or unplug) first,
// then run this. What this utility verifies either way, which is the actual
// guarantee this phase is about: every local write below (sale/items,
// wallet balance, stock, shop_status, PLUS its outbox record) completes
// synchronously against Dexie in one transaction with zero dependency on
// drainOutbox ever running, and once it *does* run (the "network restored"
// step), all five land correctly in Supabase.
//
// Exercises five distinct mutation paths on purpose: a complete_sale, an
// adjust_wallet_balance recharge, an adjust_wallet_balance withdrawal, a
// generic products UPDATE, and a generic shop_status UPDATE -- the same
// five shapes the old version of this harness covered, now going through
// the outbox instead of the old sync_queue.

interface TransactionResult {
  label: string;
  // Full id, kept separately from the (truncated, display-only) label --
  // verification queries against Supabase need the real value.
  entityId?: string;
  outboxId?: number;
  queuedOk: boolean;
  pushOutcome?: "synced" | "conflict" | "queued" | "still-pending";
  verifiedInSupabase?: boolean;
  error?: string;
}

export interface OfflineSyncReport {
  generated: number;
  pushed: number;
  verified: number;
  results: TransactionResult[];
}

async function requireSeedRow<T>(label: string, fetcher: () => Promise<T | undefined>): Promise<T> {
  const row = await fetcher();
  if (!row) {
    throw new Error(
      `[__TEST_OFFLINE_SYNC__] missing seed data: no ${label} found locally -- run the app once online first so it has something to attach test transactions to.`,
    );
  }
  return row;
}

export async function testOfflineSync(): Promise<OfflineSyncReport> {
  console.log("%c[__TEST_OFFLINE_SYNC__] step 1/3 -- generating 5 local transactions", "font-weight: bold");
  console.log(
    "[__TEST_OFFLINE_SYNC__] for a literal network-drop test, open DevTools > Network > Offline now, before this line finishes logging.",
  );

  const product = await requireSeedRow("product", () => db.products.toArray().then((rows) => rows[0]));
  const wallet = await requireSeedRow("student wallet", () => db.student_wallets.toArray().then((rows) => rows[0]));
  const profile = await requireSeedRow("admin profile", () => db.profiles.where("role").equals("admin").first());
  const shopStatus = await requireSeedRow("shop_status row", () => db.shop_status.get(1));

  const results: TransactionResult[] = [];

  // 1. Sale (cash, 1 unit) -- exercises complete_sale.
  try {
    const saleId = crypto.randomUUID();
    const now = new Date().toISOString();
    const sale: Sale = {
      id: saleId,
      created_at: now,
      cashier_id: profile.id,
      total_amount: product.price,
      payment_method: "cash",
      status: "completed",
      updated_at: now,
    };
    const item: SaleItem = {
      id: crypto.randomUUID(),
      sale_id: saleId,
      product_id: product.id,
      quantity: 1,
      unit_price: product.price,
      updated_at: now,
    };
    const entry = makeOutboxEntry("complete_sale", "sales", { sale, items: [item] });
    await db.transaction("rw", [db.sales, db.sale_items, db.sync_outbox], async () => {
      await db.sales.put(sale);
      await db.sale_items.put(item);
      await recordOutbox(entry);
    });
    results.push({ label: `complete_sale ${saleId.slice(0, 8)}`, entityId: saleId, outboxId: entry.id, queuedOk: true });
  } catch (error) {
    results.push({ label: "complete_sale", queuedOk: false, error: String(error) });
  }

  // 2. Wallet recharge (+100) -- exercises adjust_wallet_balance.
  try {
    const entry = makeOutboxEntry("adjust_wallet_balance", "student_wallets", {
      wallet_id: wallet.id,
      delta: 100,
      reason: "recharge",
    });
    await commitLocal(db.student_wallets, () => db.student_wallets.update(wallet.id, { balance: wallet.balance + 100 }), entry);
    results.push({ label: `adjust_wallet_balance recharge ${wallet.id.slice(0, 8)}`, entityId: wallet.id, outboxId: entry.id, queuedOk: true });
  } catch (error) {
    results.push({ label: "adjust_wallet_balance recharge", queuedOk: false, error: String(error) });
  }

  // 3. Wallet withdrawal (-50) -- same RPC, distinct reason tag.
  try {
    const entry = makeOutboxEntry("adjust_wallet_balance", "student_wallets", {
      wallet_id: wallet.id,
      delta: -50,
      reason: "withdrawal",
    });
    await commitLocal(
      db.student_wallets,
      () => db.student_wallets.update(wallet.id, { balance: wallet.balance + 100 - 50 }),
      entry,
    );
    results.push({ label: `adjust_wallet_balance withdrawal ${wallet.id.slice(0, 8)}`, entityId: wallet.id, outboxId: entry.id, queuedOk: true });
  } catch (error) {
    results.push({ label: "adjust_wallet_balance withdrawal", queuedOk: false, error: String(error) });
  }

  // 4. Generic products UPDATE -- exercises the generic push path.
  try {
    const nextStock = product.stock + 1;
    const entry = makeOutboxEntry("generic_update", "products", { id: product.id, stock: nextStock });
    await commitLocal(db.products, () => db.products.update(product.id, { stock: nextStock }), entry);
    results.push({ label: `generic_update products ${product.id.slice(0, 8)}`, entityId: product.id, outboxId: entry.id, queuedOk: true });
  } catch (error) {
    results.push({ label: "generic_update products", queuedOk: false, error: String(error) });
  }

  // 5. shop_status UPDATE -- confirms this table still has a working
  // offline path (Phase 12's original headline fix).
  try {
    const nextOpen = !shopStatus.is_open;
    const now = new Date().toISOString();
    const entry = makeOutboxEntry("generic_update", "shop_status", {
      id: 1,
      is_open: nextOpen,
      updated_by: profile.id,
      updated_at: now,
    });
    await commitLocal(
      db.shop_status,
      () => db.shop_status.put({ id: 1, is_open: nextOpen, updated_by: profile.id, updated_at: now }),
      entry,
    );
    results.push({ label: "generic_update shop_status", outboxId: entry.id, queuedOk: true });
  } catch (error) {
    results.push({ label: "generic_update shop_status", queuedOk: false, error: String(error) });
  }

  const generated = results.filter((r) => r.queuedOk).length;
  console.log(
    `[__TEST_OFFLINE_SYNC__] generated ${generated}/5 local transactions -- every one above completed against Dexie (business write + outbox record, one transaction) with no network involved at all.`,
  );

  console.log("%c[__TEST_OFFLINE_SYNC__] step 2/3 -- restoring network and draining the outbox", "font-weight: bold");
  console.log("[__TEST_OFFLINE_SYNC__] if you went offline via DevTools above, switch back Online now.");
  await drainOutbox();

  for (const result of results) {
    if (result.outboxId === undefined) continue;
    const row = await db.sync_outbox.get(result.outboxId);
    result.pushOutcome =
      row?.status === "synced"
        ? "synced"
        : row?.status === "conflict"
          ? "conflict"
          : row?.status === "pending" || row?.status === "error"
            ? "queued"
            : "still-pending";
  }

  console.log("%c[__TEST_OFFLINE_SYNC__] step 3/3 -- verifying each transaction actually landed in Supabase", "font-weight: bold");

  const [saleResult, rechargeResult, , productResult, shopStatusResult] = results;

  if (saleResult?.pushOutcome === "synced" && saleResult.entityId) {
    const { data } = await supabase.from("sales").select("id").eq("id", saleResult.entityId).maybeSingle();
    saleResult.verifiedInSupabase = data?.id === saleResult.entityId;
  }
  if (rechargeResult?.pushOutcome === "synced") {
    const { data } = await supabase.from("student_wallets").select("balance").eq("id", wallet.id).single();
    rechargeResult.verifiedInSupabase = data?.balance === wallet.balance + 100 - 50;
  }
  if (productResult?.pushOutcome === "synced") {
    const { data } = await supabase.from("products").select("stock").eq("id", product.id).single();
    productResult.verifiedInSupabase = data?.stock === product.stock + 1;
  }
  if (shopStatusResult?.pushOutcome === "synced") {
    const { data } = await supabase.from("shop_status").select("is_open").eq("id", 1).single();
    shopStatusResult.verifiedInSupabase = data?.is_open === !shopStatus.is_open;
  }

  const pushed = results.filter((r) => r.pushOutcome === "synced").length;
  const verified = results.filter((r) => r.verifiedInSupabase).length;

  console.table(
    results.map((r) => ({
      transaction: r.label,
      queued: r.queuedOk,
      pushOutcome: r.pushOutcome ?? "n/a",
      verifiedInSupabase: r.verifiedInSupabase ?? "n/a",
      error: r.error ?? "",
    })),
  );
  console.log(
    `%c[__TEST_OFFLINE_SYNC__] done: ${generated}/5 generated locally, ${pushed}/5 pushed successfully, ${verified} directly re-verified against Supabase.`,
    generated === 5 && pushed === 5 ? "color: green; font-weight: bold" : "color: orange; font-weight: bold",
  );

  return { generated, pushed, verified, results };
}
