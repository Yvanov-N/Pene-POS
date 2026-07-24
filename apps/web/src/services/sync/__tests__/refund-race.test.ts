import { describe, expect, it } from "vitest";
import { signInAsDevAdmin, newSale, SEED_PRODUCT_ID } from "./testHelpers";

// Regression test for Finding B: the old refundService.voidSale (and
// MoMoVerificationCard's reject flow) restocked a product by reading its
// current stock into a local snapshot, adding the refunded quantity, and
// pushing the ENTIRE row back as a last-write-wins UPDATE -- a sale ringing
// up on another terminal between that read and that write was silently
// overwritten. void_sale (migration 00029) restocks via the same atomic
// adjust_product_stock delta complete_sale uses, so it can't lose a
// concurrent terminal's decrement. This test runs a void concurrently with
// an unrelated sale of the same product and asserts the final stock is
// mathematically correct regardless of statement interleaving.
describe("refund race (void_sale concurrent with an independent sale)", () => {
  it("final stock reflects BOTH the voided sale's restock AND the concurrent sale's decrement, never just one", async () => {
    const { client, adminId } = await signInAsDevAdmin();

    // Sale #1: will be voided.
    const toVoid = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 5, unitPrice: 500 });
    await client.rpc("complete_sale", { p_operation_id: toVoid.operationId, p_sale: toVoid.sale, p_items: toVoid.items });

    const { data: baseline } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();
    const stockAfterFirstSale = baseline!.stock!;

    // Sale #2: concurrent, independent, NOT voided.
    const concurrent = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 3, unitPrice: 500 });

    const [voidResult, saleResult] = await Promise.all([
      client.rpc("void_sale", { p_operation_id: crypto.randomUUID(), p_sale_id: toVoid.sale.id, p_admin_id: adminId }),
      client.rpc("complete_sale", { p_operation_id: concurrent.operationId, p_sale: concurrent.sale, p_items: concurrent.items }),
    ]);

    expect(voidResult.error).toBeNull();
    expect(saleResult.error).toBeNull();
    expect((voidResult.data as { outcome: string }).outcome).toBe("completed");
    expect((saleResult.data as { outcome: string }).outcome).toBe("completed");

    const { data: final } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();
    // +5 restocked by the void, -3 taken by the concurrent sale, regardless
    // of which one's UPDATE happened to commit first -- a whole-row
    // overwrite bug would instead show only one of these two effects,
    // depending on interleaving order.
    expect(final!.stock).toBe(stockAfterFirstSale + 5 - 3);
  });

  it("voiding an already-refunded sale is rejected as a conflict, not a silent double-restock", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const sale = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 1, unitPrice: 500 });
    await client.rpc("complete_sale", { p_operation_id: sale.operationId, p_sale: sale.sale, p_items: sale.items });

    const firstVoid = await client.rpc("void_sale", {
      p_operation_id: crypto.randomUUID(),
      p_sale_id: sale.sale.id,
      p_admin_id: adminId,
    });
    expect((firstVoid.data as { outcome: string }).outcome).toBe("completed");

    const { data: afterFirstVoid } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();

    const secondVoid = await client.rpc("void_sale", {
      p_operation_id: crypto.randomUUID(),
      p_sale_id: sale.sale.id,
      p_admin_id: adminId,
    });
    expect((secondVoid.data as { outcome: string }).outcome).toBe("conflict");

    const { data: afterSecondVoid } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();
    expect(afterSecondVoid!.stock).toBe(afterFirstVoid!.stock); // unchanged -- no double restock
  });
});
