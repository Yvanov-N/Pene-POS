import { describe, expect, it } from "vitest";
import {
  signInAsDevAdmin,
  createTestWallet,
  newSale,
  SEED_PRODUCT_ID,
} from "./testHelpers";

// Covers the "duplicate sale under retry" and "wallet double-adjustment
// under retry" scenarios directly -- the root cause this rebuild's
// operationId ledger (public.sync_operations, migration 00024) exists to
// close. A retried push (lost response, duplicate offline-queue drain) must
// be a safe no-op replay, never a second effect.
describe("idempotency (operationId ledger)", () => {
  it("complete_sale: replaying the same operationId applies the stock delta exactly once", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const { data: before } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();

    const { operationId, sale, items } = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 2, unitPrice: 500 });

    const first = await client.rpc("complete_sale", { p_operation_id: operationId, p_sale: sale, p_items: items });
    expect(first.error).toBeNull();
    expect((first.data as { outcome: string }).outcome).toBe("completed");

    const second = await client.rpc("complete_sale", { p_operation_id: operationId, p_sale: sale, p_items: items });
    expect(second.error).toBeNull();
    expect((second.data as { outcome: string }).outcome).toBe("replayed");

    const { data: after } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();
    expect(after!.stock).toBe(before!.stock! - 2);
  });

  it("complete_sale: the SAME sale id retried under a DIFFERENT operationId is still a safe no-op (unique_violation branch)", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const { data: before } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();

    const { sale, items } = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 1, unitPrice: 500 });

    const first = await client.rpc("complete_sale", { p_operation_id: crypto.randomUUID(), p_sale: sale, p_items: items });
    expect(first.error).toBeNull();

    const retry = await client.rpc("complete_sale", { p_operation_id: crypto.randomUUID(), p_sale: sale, p_items: items });
    expect(retry.error).toBeNull();
    expect((retry.data as { outcome: string }).outcome).toBe("completed");

    const { data: after } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();
    expect(after!.stock).toBe(before!.stock! - 1);
  });

  it("adjust_wallet_balance: replaying the same operationId applies the delta exactly once", async () => {
    const { client } = await signInAsDevAdmin();
    const walletId = await createTestWallet(client, 1000);
    const operationId = crypto.randomUUID();

    const first = await client.rpc("adjust_wallet_balance", { p_operation_id: operationId, p_wallet_id: walletId, p_delta: 250 });
    expect(first.error).toBeNull();
    expect((first.data as { outcome: string }).outcome).toBe("completed");

    const second = await client.rpc("adjust_wallet_balance", { p_operation_id: operationId, p_wallet_id: walletId, p_delta: 250 });
    expect(second.error).toBeNull();
    expect((second.data as { outcome: string }).outcome).toBe("replayed");

    const { data } = await client.from("student_wallets").select("balance").eq("id", walletId).single();
    expect(data!.balance).toBe(1250);
  });

  it("void_sale: replaying the same operationId restores stock exactly once", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const { sale, items } = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 3, unitPrice: 500 });
    await client.rpc("complete_sale", { p_operation_id: crypto.randomUUID(), p_sale: sale, p_items: items });

    const { data: afterSale } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();

    const voidOpId = crypto.randomUUID();
    const first = await client.rpc("void_sale", { p_operation_id: voidOpId, p_sale_id: sale.id, p_admin_id: adminId });
    expect(first.error).toBeNull();
    expect((first.data as { outcome: string }).outcome).toBe("completed");

    const second = await client.rpc("void_sale", { p_operation_id: voidOpId, p_sale_id: sale.id, p_admin_id: adminId });
    expect(second.error).toBeNull();
    expect((second.data as { outcome: string }).outcome).toBe("replayed");

    const { data: afterVoid } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();
    expect(afterVoid!.stock).toBe(afterSale!.stock! + 3);
  });
});
