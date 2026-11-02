import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { fetchWatermarks, pullAll } from "@/services/sync/pull";
import { SEED_PRODUCT_ID } from "./testHelpers";

// sync_watermarks (migration 00039): a quiet sync cycle must cost one
// request, and a change must only re-pull the table it happened in.
describe("watermark-driven pull", () => {
  let originalPrice: number;

  beforeAll(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: "admin@penepos.dev", password: "DevAdmin123!" });
    if (error) throw error;
    const { data } = await supabase.from("products").select("price").eq("id", SEED_PRODUCT_ID).single();
    originalPrice = data!.price;
  });

  afterAll(async () => {
    await supabase.from("products").update({ price: originalPrice }).eq("id", SEED_PRODUCT_ID);
    await supabase.auth.signOut();
  });

  it("reports a watermark per synced table", async () => {
    const result = await fetchWatermarks();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.watermarks.products).toBeGreaterThan(0);
    expect(result.watermarks.sales).toBeGreaterThan(0);
  });

  it("pulls nothing when nothing changed, then only the table that changed", async () => {
    await pullAll(); // catch up fully first
    expect((await pullAll()).reachable).toBe(true);

    const from = vi.spyOn(supabase, "from");
    await pullAll();
    expect(from).not.toHaveBeenCalled();

    // Another till edits a product.
    from.mockRestore();
    await supabase.from("products").update({ price: originalPrice + 1 }).eq("id", SEED_PRODUCT_ID);
    const spy = vi.spyOn(supabase, "from");
    await pullAll();
    expect(spy.mock.calls.map(([table]) => table)).toEqual(["products"]);
    spy.mockRestore();

    expect((await db.products.get(SEED_PRODUCT_ID))?.price).toBe(originalPrice + 1);
  });

  it("collapses concurrent calls into one pull plus at most one re-run", async () => {
    const rpc = vi.spyOn(supabase, "rpc");
    await Promise.all([pullAll(), pullAll(), pullAll(), pullAll()]);
    // first pass + a single coalesced re-run, not four passes
    expect(rpc.mock.calls.filter(([fn]) => fn === "sync_watermarks").length).toBeLessThanOrEqual(2);
    rpc.mockRestore();
  });
});
