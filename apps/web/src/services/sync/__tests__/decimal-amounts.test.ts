import { describe, expect, it } from "vitest";
import { createTestWallet, newSale, signInAsDevAdmin, SEED_PRODUCT_ID } from "./testHelpers";

// Decimal amounts end to end: numeric columns and the RPCs must keep cents
// exactly (no integer casts anywhere on the way).
describe("decimal amounts", () => {
  it("a wallet sale of 3 x 12.50 stores 37.50 and debits the wallet by exactly that", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const walletId = await createTestWallet(client, 100.25);

    const sale = newSale({
      cashierId: adminId,
      productId: SEED_PRODUCT_ID,
      quantity: 3,
      unitPrice: 12.5,
      paymentMethod: "student_wallet",
      studentId: walletId,
    });
    const { data, error } = await client.rpc("complete_sale", {
      p_operation_id: sale.operationId,
      p_sale: sale.sale,
      p_items: sale.items,
    });
    expect(error).toBeNull();
    expect((data as { outcome: string }).outcome).toBe("completed");

    const { data: stored } = await client.from("sales").select("total_amount").eq("id", sale.sale.id).single();
    expect(stored!.total_amount).toBe(37.5);
    const { data: line } = await client.from("sale_items").select("unit_price").eq("sale_id", sale.sale.id).single();
    expect(line!.unit_price).toBe(12.5);
    const { data: wallet } = await client.from("student_wallets").select("balance").eq("id", walletId).single();
    expect(wallet!.balance).toBe(62.75);
  });

  it("a wallet recharge of 1500.50 is kept to the cent", async () => {
    const { client } = await signInAsDevAdmin();
    const walletId = await createTestWallet(client, 0);
    const { error } = await client.rpc("adjust_wallet_balance", {
      p_operation_id: crypto.randomUUID(),
      p_wallet_id: walletId,
      p_delta: 1500.5,
      p_reason: "recharge",
    });
    expect(error).toBeNull();
    const { data: wallet } = await client.from("student_wallets").select("balance").eq("id", walletId).single();
    expect(wallet!.balance).toBe(1500.5);
  });
});
