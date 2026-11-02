import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { pullAll } from "@/services/sync/pull";
import { confirmMomoSale, rejectMomoSale } from "@/services/momoVerification";
import { newSale, SEED_LOW_STOCK_PRODUCT_ID } from "./testHelpers";

// Rejecting a Mobile Money payment (no SMS ever arrived) must cancel the
// sale -- not just flag it -- and put the stock back.
describe("Mobile Money verification", () => {
  let adminId: string;

  beforeAll(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: "admin@penepos.dev", password: "DevAdmin123!" });
    if (error) throw error;
    adminId = data.user.id;
  });
  afterAll(() => supabase.auth.signOut());
  // Node has no navigator.onLine -- same stub as drain-retry.test.ts.
  beforeEach(() => vi.stubGlobal("navigator", { onLine: true }));
  afterEach(() => vi.unstubAllGlobals());

  async function pendingMomoSale(quantity: number) {
    const sale = newSale({ cashierId: adminId, productId: SEED_LOW_STOCK_PRODUCT_ID, quantity, unitPrice: 350, paymentMethod: "momo_mtn" });
    const { error } = await supabase.rpc("complete_sale", {
      p_operation_id: sale.operationId,
      p_sale: { ...sale.sale, momo_verification_status: "pending" },
      p_items: sale.items,
    });
    if (error) throw error;
    await pullAll();
    return sale.sale.id;
  }

  const serverSale = async (id: string) =>
    (await supabase.from("sales").select("status, momo_verification_status").eq("id", id).single()).data;
  const serverStock = async () =>
    (await supabase.from("products").select("stock").eq("id", SEED_LOW_STOCK_PRODUCT_ID).single()).data!.stock;

  it("reject cancels the sale and restores the stock", async () => {
    const saleId = await pendingMomoSale(2);
    const stockAfterSale = await serverStock();

    const result = await rejectMomoSale(saleId, adminId);
    expect(result.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // eager pushes land

    expect(await serverSale(saleId)).toEqual({ status: "refunded", momo_verification_status: "rejected" });
    expect(await serverStock()).toBe(stockAfterSale + 2);
    expect(await db.sales.get(saleId)).toMatchObject({ status: "refunded", momo_verification_status: "rejected" });
  });

  it("confirm keeps the sale and marks the payment verified", async () => {
    const saleId = await pendingMomoSale(1);
    await confirmMomoSale(saleId);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await serverSale(saleId)).toEqual({ status: "completed", momo_verification_status: "confirmed" });
  });
});
