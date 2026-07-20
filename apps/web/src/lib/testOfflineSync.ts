import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { enqueueMutation, processSyncQueue } from "@/services/syncService";
import type { Sale, SaleItem } from "@/types/db";

// Dev-console verification utility (window.__TEST_OFFLINE_SYNC__, wired up
// in main.tsx behind import.meta.env.DEV -- this deliberately never ships in
// a production build). A real network drop can't actually be triggered from
// page JS (navigator.onLine is read-only, reflecting real OS/network state)
// -- for a literal test, open DevTools > Network > Offline (or unplug) first,
// then run this. What this utility verifies either way, which is the actual
// guarantee this phase is about: every local write below completes
// synchronously against Dexie with zero dependency on processSyncQueue ever
// running, and once it *does* run (the "network restored" step), all five
// land correctly in Supabase.
//
// Exercises five distinct mutation paths on purpose: a SALE, a
// WALLET_RECHARGE, a WALLET_WITHDRAWAL, a generic products UPDATE, and a
// shop_status UPDATE -- the last one specifically proves the Phase 12 fix
// (useShopStatus used to write straight to Supabase with no local mirror at
// all, so toggling shop status simply didn't work offline; it's now exactly
// as offline-first as every other table).

interface TransactionResult {
  label: string;
  // Full id, kept separately from the (truncated, display-only) label --
  // verification queries against Supabase need the real value.
  entityId?: string;
  queueId?: number;
  queuedOk: boolean;
  pushOutcome?: "completed" | "conflict_warning" | "failed" | "still-pending";
  verifiedInSupabase?: boolean;
  error?: string;
}

export interface OfflineSyncReport {
  generated: number;
  pushed: number;
  verified: number;
  results: TransactionResult[];
}

async function requireSeedRow<T>(
  label: string,
  fetcher: () => Promise<T | undefined>,
): Promise<T> {
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
  const queueIds: number[] = [];

  // 1. Sale (cash, 1 unit) -- exercises pushSale.
  try {
    const saleId = crypto.randomUUID();
    const sale: Sale = {
      id: saleId,
      created_at: new Date().toISOString(),
      cashier_id: profile.id,
      total_amount: product.price,
      payment_method: "cash",
      status: "pending_sync",
    };
    const item: SaleItem = { id: crypto.randomUUID(), sale_id: saleId, product_id: product.id, quantity: 1, unit_price: product.price };
    await db.sales.put(sale);
    await db.sale_items.put(item);
    await enqueueMutation("SALE", "sales", { sale, items: [item] });
    const queued = await db.sync_queue.orderBy("id").last();
    results.push({ label: `SALE ${saleId.slice(0, 8)}`, entityId: saleId, queueId: queued?.id, queuedOk: true });
    if (queued?.id !== undefined) queueIds.push(queued.id);
  } catch (error) {
    results.push({ label: "SALE", queuedOk: false, error: String(error) });
  }

  // 2. Wallet recharge (+100) -- exercises pushWalletBalanceAdjustment.
  try {
    await db.student_wallets.update(wallet.id, { balance: wallet.balance + 100 });
    await enqueueMutation("WALLET_RECHARGE", "student_wallets", { wallet_id: wallet.id, delta: 100 });
    const queued = await db.sync_queue.orderBy("id").last();
    results.push({ label: `WALLET_RECHARGE ${wallet.id.slice(0, 8)}`, entityId: wallet.id, queueId: queued?.id, queuedOk: true });
    if (queued?.id !== undefined) queueIds.push(queued.id);
  } catch (error) {
    results.push({ label: "WALLET_RECHARGE", queuedOk: false, error: String(error) });
  }

  // 3. Wallet withdrawal (-50) -- exercises the same push path, distinct action.
  try {
    await db.student_wallets.update(wallet.id, { balance: wallet.balance + 100 - 50 });
    await enqueueMutation("WALLET_WITHDRAWAL", "student_wallets", { wallet_id: wallet.id, delta: -50 });
    const queued = await db.sync_queue.orderBy("id").last();
    results.push({ label: `WALLET_WITHDRAWAL ${wallet.id.slice(0, 8)}`, entityId: wallet.id, queueId: queued?.id, queuedOk: true });
    if (queued?.id !== undefined) queueIds.push(queued.id);
  } catch (error) {
    results.push({ label: "WALLET_WITHDRAWAL", queuedOk: false, error: String(error) });
  }

  // 4. Generic products UPDATE -- exercises pushGeneric.
  try {
    const nextStock = product.stock + 1;
    await db.products.update(product.id, { stock: nextStock });
    await enqueueMutation("UPDATE", "products", { id: product.id, stock: nextStock });
    const queued = await db.sync_queue.orderBy("id").last();
    results.push({ label: `UPDATE products ${product.id.slice(0, 8)}`, entityId: product.id, queueId: queued?.id, queuedOk: true });
    if (queued?.id !== undefined) queueIds.push(queued.id);
  } catch (error) {
    results.push({ label: "UPDATE products", queuedOk: false, error: String(error) });
  }

  // 5. shop_status UPDATE -- the Phase 12 headline fix: this table used to
  // have no offline path at all.
  try {
    const nextOpen = !shopStatus.is_open;
    const now = new Date().toISOString();
    await db.shop_status.put({ id: 1, is_open: nextOpen, updated_by: profile.id, updated_at: now });
    await enqueueMutation("UPDATE", "shop_status", { id: 1, is_open: nextOpen, updated_by: profile.id, updated_at: now });
    const queued = await db.sync_queue.orderBy("id").last();
    results.push({ label: "UPDATE shop_status", queueId: queued?.id, queuedOk: true });
    if (queued?.id !== undefined) queueIds.push(queued.id);
  } catch (error) {
    results.push({ label: "UPDATE shop_status", queuedOk: false, error: String(error) });
  }

  const generated = results.filter((r) => r.queuedOk).length;
  console.log(
    `[__TEST_OFFLINE_SYNC__] generated ${generated}/5 local transactions -- every one above completed against Dexie with no network involved at all.`,
  );

  console.log("%c[__TEST_OFFLINE_SYNC__] step 2/3 -- restoring network and running processSyncQueue()", "font-weight: bold");
  console.log("[__TEST_OFFLINE_SYNC__] if you went offline via DevTools above, switch back Online now.");
  await processSyncQueue();

  for (const result of results) {
    if (result.queueId === undefined) continue;
    const item = await db.sync_queue.get(result.queueId);
    result.pushOutcome =
      item?.status === "completed" || item?.status === "conflict_warning" || item?.status === "failed"
        ? item.status
        : "still-pending";
  }

  console.log("%c[__TEST_OFFLINE_SYNC__] step 3/3 -- verifying each transaction actually landed in Supabase", "font-weight: bold");

  const [saleResult, walletResult, , productResult, shopStatusResult] = results;

  if (saleResult?.pushOutcome === "completed" && saleResult.entityId) {
    const { data } = await supabase.from("sales").select("id").eq("id", saleResult.entityId).maybeSingle();
    saleResult.verifiedInSupabase = data?.id === saleResult.entityId;
  }
  if (walletResult?.pushOutcome === "completed") {
    const { data } = await supabase.from("student_wallets").select("balance").eq("id", wallet.id).single();
    walletResult.verifiedInSupabase = data?.balance === wallet.balance + 100 - 50;
  }
  if (productResult?.pushOutcome === "completed") {
    const { data } = await supabase.from("products").select("stock").eq("id", product.id).single();
    productResult.verifiedInSupabase = data?.stock === product.stock + 1;
  }
  if (shopStatusResult?.pushOutcome === "completed") {
    const { data } = await supabase.from("shop_status").select("is_open").eq("id", 1).single();
    shopStatusResult.verifiedInSupabase = data?.is_open === !shopStatus.is_open;
  }

  const pushed = results.filter((r) => r.pushOutcome === "completed").length;
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
