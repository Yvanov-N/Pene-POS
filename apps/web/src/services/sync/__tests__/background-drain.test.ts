import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { drainOutboxWith } from "@/services/sync/drainCore";
import { pushOutboxWith } from "@/services/sync/pushCore";
import type { Database } from "@/types/supabase";
import type { Sale, SaleItem } from "@/types/db";
import { LOCAL_SUPABASE_URL, SEED_PRODUCT_ID, signInAsDevAdmin } from "./testHelpers";

const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// What the service worker's Background Sync does (src/sw.ts): no session, no
// refresh -- just the mirrored access token as a bearer header -- and the
// same shared drain/push code as the page.
describe("background drain (service worker path)", () => {
  // Node has no navigator.onLine (reads as offline to pushOutboxWith's
  // "certainly offline" guard) -- same stub as drain-retry.test.ts.
  beforeEach(() => vi.stubGlobal("navigator", { onLine: true }));
  afterEach(() => vi.unstubAllGlobals());

  it("sends a queued sale with only the mirrored access token", async () => {
    const { client: signedIn, adminId } = await signInAsDevAdmin();
    const { data: sessionData } = await signedIn.auth.getSession();
    const accessToken = sessionData.session!.access_token;

    const saleId = crypto.randomUUID();
    const now = new Date().toISOString();
    const sale: Sale = {
      id: saleId,
      created_at: now,
      cashier_id: adminId,
      total_amount: 500,
      payment_method: "cash",
      status: "completed",
      updated_at: now,
    };
    const items: SaleItem[] = [
      { id: crypto.randomUUID(), sale_id: saleId, product_id: SEED_PRODUCT_ID, quantity: 1, unit_price: 500, updated_at: now },
    ];
    await db.sync_outbox.clear();
    await recordOutbox(makeOutboxEntry("complete_sale", "sales", { sale, items }));

    const workerClient = createClient<Database>(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const summary = await drainOutboxWith((entry) => pushOutboxWith(workerClient, entry));

    expect(summary).toEqual({ syncedSales: 1, conflicts: 0 });
    expect(await db.sync_outbox.where("status").anyOf(["pending", "error"]).count()).toBe(0);
    const { data: onServer } = await signedIn.from("sales").select("id, total_amount").eq("id", saleId).single();
    expect(onServer).toEqual({ id: saleId, total_amount: 500 });
  });
});
