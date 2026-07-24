import { describe, expect, it } from "vitest";
import { signInAsDevAdmin, createLocalSupabaseClient, newSale, SEED_LOW_STOCK_PRODUCT_ID } from "./testHelpers";

// Confirms the kept business rule from migration 00019: a genuine
// cross-terminal oversell must settle to a negative stock value and
// complete normally, never block as a conflict -- and that it's tracked
// (a sync_events row), not silently swallowed. Two terminals independently
// selling the last units of the same low-stock product is exactly the race
// the old whole-row-overwrite bugs (refundService.voidSale, MoMoVerification-
// Card's reject flow) were vulnerable to; complete_sale's atomic per-line
// `adjust_product_stock` delta must not lose either terminal's decrement.
describe("stock race (concurrent oversell)", () => {
  it("two concurrent sales against a 2-unit product both complete, and stock settles to exactly -2", async () => {
    const { client, adminId } = await signInAsDevAdmin();

    const { data: before } = await client.from("products").select("stock").eq("id", SEED_LOW_STOCK_PRODUCT_ID).single();
    const startingStock = before!.stock!;

    const saleA = newSale({ cashierId: adminId, productId: SEED_LOW_STOCK_PRODUCT_ID, quantity: 2, unitPrice: 350 });
    const saleB = newSale({ cashierId: adminId, productId: SEED_LOW_STOCK_PRODUCT_ID, quantity: 2, unitPrice: 350 });

    const [resultA, resultB] = await Promise.all([
      client.rpc("complete_sale", { p_operation_id: saleA.operationId, p_sale: saleA.sale, p_items: saleA.items }),
      client.rpc("complete_sale", { p_operation_id: saleB.operationId, p_sale: saleB.sale, p_items: saleB.items }),
    ]);

    expect(resultA.error).toBeNull();
    expect(resultB.error).toBeNull();
    expect((resultA.data as { outcome: string }).outcome).toBe("completed");
    expect((resultB.data as { outcome: string }).outcome).toBe("completed");

    const { data: after } = await client.from("products").select("stock").eq("id", SEED_LOW_STOCK_PRODUCT_ID).single();
    expect(after!.stock).toBe(startingStock - 4);

    // At least one of the two lines should have flagged negative_stock in
    // its own result (whichever one crossed zero) -- both results carry a
    // per-sale negative_stock flag.
    const anyNegative =
      (resultA.data as { negative_stock: boolean }).negative_stock || (resultB.data as { negative_stock: boolean }).negative_stock;
    expect(anyNegative).toBe(true);
  });

  it("a negative-stock outcome is tracked in sync_events for admin visibility", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const adminClient = createLocalSupabaseClient();
    // Re-sign-in on a fresh client so sync_events (admin-only SELECT) is
    // read under a real authenticated admin session, matching what the
    // Sync Health dashboard does.
    await adminClient.auth.signInWithPassword({ email: "admin@penepos.dev", password: "DevAdmin123!" });

    const { data: before } = await client.from("products").select("stock").eq("id", SEED_LOW_STOCK_PRODUCT_ID).single();
    if (before!.stock! >= 0) {
      // Force it negative first so this run's own oversell is unambiguous.
      const setup = newSale({ cashierId: adminId, productId: SEED_LOW_STOCK_PRODUCT_ID, quantity: before!.stock! + 1, unitPrice: 350 });
      await client.rpc("complete_sale", { p_operation_id: setup.operationId, p_sale: setup.sale, p_items: setup.items });
    }

    const oversell = newSale({ cashierId: adminId, productId: SEED_LOW_STOCK_PRODUCT_ID, quantity: 1, unitPrice: 350 });
    const result = await client.rpc("complete_sale", {
      p_operation_id: oversell.operationId,
      p_sale: oversell.sale,
      p_items: oversell.items,
    });
    expect((result.data as { negative_stock: boolean }).negative_stock).toBe(true);

    // The event's operation_id is the INNER adjust_product_stock call's own
    // freshly-generated id (migration 00028 mints one per line item), not
    // complete_sale's own outer operationId -- correlate by context.reason
    // instead, which complete_sale tags as "sale:<sale id>" for exactly
    // this purpose.
    const { data: events, error } = await adminClient
      .from("sync_events")
      .select("event_type,entity_id,context")
      .eq("event_type", "negative_stock")
      .eq("entity_id", SEED_LOW_STOCK_PRODUCT_ID)
      .order("occurred_at", { ascending: false })
      .limit(5);
    expect(error).toBeNull();
    const match = events?.find((e) => (e.context as { reason?: string } | null)?.reason === `sale:${oversell.sale.id}`);
    expect(match).toBeDefined();
  });
});
