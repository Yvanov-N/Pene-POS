import { describe, expect, it } from "vitest";
import { signInAsDevAdmin } from "./testHelpers";

// Broad guard against general "data corruption/wrong values" (one of the
// reported production bug classes): fires many concurrent sale/void/direct-
// adjustment operations -- simulating several terminals hammering the same
// product/wallet at once -- against fresh, test-only rows, then asserts the
// server's final state reconciles EXACTLY against the sum of every
// individual operation's own effect. Any lost update (a whole-row overwrite
// clobbering a concurrent delta, a non-idempotent retry double-applying)
// would show up here as a mismatch, without needing to know in advance
// which specific operation pair would have raced.
describe("reconciliation fuzz (concurrent load against fresh rows)", () => {
  it("stock: N concurrent sales + M concurrent voids reconcile to the exact expected total", async () => {
    const { client, adminId } = await signInAsDevAdmin();

    const productId = crypto.randomUUID();
    const startingStock = 500;
    const { error: insertError } = await client.from("products").insert({
      id: productId,
      name: "Fuzz Test Product",
      price: 100,
      stock: startingStock,
      barcode: `FUZZ-${productId.slice(0, 8)}`,
    });
    expect(insertError).toBeNull();

    const SALE_COUNT = 15;
    const saleQuantities = Array.from({ length: SALE_COUNT }, (_, i) => (i % 3) + 1); // 1,2,3,1,2,3,...
    const saleIds = saleQuantities.map(() => crypto.randomUUID());

    // Round 1: fire every sale concurrently.
    const saleResults = await Promise.all(
      saleQuantities.map((quantity, i) =>
        client.rpc("complete_sale", {
          p_operation_id: crypto.randomUUID(),
          p_sale: { id: saleIds[i], cashier_id: adminId, total_amount: quantity * 100, payment_method: "cash" },
          p_items: [{ id: crypto.randomUUID(), sale_id: saleIds[i], product_id: productId, quantity, unit_price: 100 }],
        }),
      ),
    );
    for (const result of saleResults) {
      expect(result.error).toBeNull();
      expect((result.data as { outcome: string }).outcome).toBe("completed");
    }
    const totalSold = saleQuantities.reduce((sum, q) => sum + q, 0);

    const { data: afterSales } = await client.from("products").select("stock").eq("id", productId).single();
    expect(afterSales!.stock).toBe(startingStock - totalSold);

    // Round 2: void half of them, concurrently.
    const toVoid = saleIds.slice(0, Math.floor(SALE_COUNT / 2));
    const voidedQuantities = saleQuantities.slice(0, toVoid.length);
    const voidResults = await Promise.all(
      toVoid.map((saleId) => client.rpc("void_sale", { p_operation_id: crypto.randomUUID(), p_sale_id: saleId, p_admin_id: adminId })),
    );
    for (const result of voidResults) {
      expect(result.error).toBeNull();
      expect((result.data as { outcome: string }).outcome).toBe("completed");
    }
    const totalRestocked = voidedQuantities.reduce((sum, q) => sum + q, 0);

    const { data: final } = await client.from("products").select("stock").eq("id", productId).single();
    expect(final!.stock).toBe(startingStock - totalSold + totalRestocked);
  });

  it("wallet balance: many concurrent recharge/withdrawal deltas reconcile to the exact expected sum", async () => {
    const { client } = await signInAsDevAdmin();

    const walletId = crypto.randomUUID();
    const startingBalance = 10000;
    const { error: insertError } = await client
      .from("student_wallets")
      .insert({ id: walletId, student_name: "Fuzz Test Wallet", badge_code: `FUZZ-${walletId.slice(0, 8)}`, balance: startingBalance });
    expect(insertError).toBeNull();

    const deltas = [500, -200, 300, -1000, 150, 150, -50, 1000, -300, 75];
    const results = await Promise.all(
      deltas.map((delta) => client.rpc("adjust_wallet_balance", { p_operation_id: crypto.randomUUID(), p_wallet_id: walletId, p_delta: delta })),
    );
    for (const result of results) {
      expect(result.error).toBeNull();
      expect((result.data as { outcome: string }).outcome).toBe("completed");
    }

    const expectedBalance = startingBalance + deltas.reduce((sum, d) => sum + d, 0);
    const { data: final } = await client.from("student_wallets").select("balance").eq("id", walletId).single();
    expect(final!.balance).toBe(expectedBalance);
  });
});
