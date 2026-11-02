import { describe, expect, it } from "vitest";
import { newSale, signInAsDevAdmin, SEED_PRODUCT_ID } from "./testHelpers";

// record_restock (migration 00036): one idempotent call records the purchase,
// adds stock, sets the product's last purchase price and the supplier's offer
// -- and later sales snapshot that cost on their lines.
describe("record_restock", () => {
  async function createSupplier(client: Awaited<ReturnType<typeof signInAsDevAdmin>>["client"]) {
    const id = crypto.randomUUID();
    const { error } = await client.from("suppliers").insert({ id, name: `Test supplier ${id.slice(0, 6)}`, phone: "+237 600 00 00 00" });
    if (error) throw error;
    return id;
  }

  it("records the purchase, stock, cost price and offer, and replays safely", async () => {
    const { client } = await signInAsDevAdmin();
    const supplierId = await createSupplier(client);
    const { data: before } = await client.from("products").select("stock").eq("id", SEED_PRODUCT_ID).single();

    const operationId = crypto.randomUUID();
    const args = {
      p_operation_id: operationId,
      p_product_id: SEED_PRODUCT_ID,
      p_supplier_id: supplierId,
      p_quantity: 24,
      p_unit_cost: 325,
    };
    const first = await client.rpc("record_restock", args);
    expect(first.error).toBeNull();
    expect((first.data as { outcome: string }).outcome).toBe("completed");

    const replay = await client.rpc("record_restock", args);
    expect(replay.error).toBeNull();
    expect((replay.data as { outcome: string }).outcome).toBe("replayed");

    const { data: after } = await client.from("products").select("stock, cost_price").eq("id", SEED_PRODUCT_ID).single();
    expect(after!.stock).toBe(before!.stock + 24);
    expect(after!.cost_price).toBe(325);

    const { data: purchase } = await client.from("stock_purchases").select("*").eq("id", operationId).single();
    expect(purchase).toMatchObject({ product_id: SEED_PRODUCT_ID, supplier_id: supplierId, quantity: 24, unit_cost: 325, total_cost: 7800 });

    const { data: offers } = await client
      .from("supplier_products")
      .select("price")
      .eq("supplier_id", supplierId)
      .eq("product_id", SEED_PRODUCT_ID);
    expect(offers).toEqual([{ price: 325 }]);
  });

  it("updates the existing offer instead of duplicating it", async () => {
    const { client } = await signInAsDevAdmin();
    const supplierId = await createSupplier(client);
    for (const cost of [300, 310]) {
      const { error } = await client.rpc("record_restock", {
        p_operation_id: crypto.randomUUID(),
        p_product_id: SEED_PRODUCT_ID,
        p_supplier_id: supplierId,
        p_quantity: 1,
        p_unit_cost: cost,
      });
      expect(error).toBeNull();
    }
    const { data: offers } = await client.from("supplier_products").select("price").eq("supplier_id", supplierId);
    expect(offers).toEqual([{ price: 310 }]);
  });

  it("stores the purchase total rounded to the franc", async () => {
    const { client } = await signInAsDevAdmin();
    const supplierId = await createSupplier(client);
    const operationId = crypto.randomUUID();
    const { error } = await client.rpc("record_restock", {
      p_operation_id: operationId,
      p_product_id: SEED_PRODUCT_ID,
      p_supplier_id: supplierId,
      p_quantity: 12,
      p_unit_cost: 83.33,
    });
    expect(error).toBeNull();
    const { data } = await client.from("stock_purchases").select("unit_cost, total_cost").eq("id", operationId).single();
    expect(data).toEqual({ unit_cost: 83.33, total_cost: 1000 });
  });

  it("is a conflict for a deleted supplier", async () => {
    const { client } = await signInAsDevAdmin();
    const supplierId = await createSupplier(client);
    await client.from("suppliers").update({ deleted_at: new Date().toISOString() }).eq("id", supplierId);
    const { data, error } = await client.rpc("record_restock", {
      p_operation_id: crypto.randomUUID(),
      p_product_id: SEED_PRODUCT_ID,
      p_supplier_id: supplierId,
      p_quantity: 1,
      p_unit_cost: 100,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "conflict", reason: "supplier_not_found" });
  });

  it("snapshots the purchase price on sale lines", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const supplierId = await createSupplier(client);
    await client.rpc("record_restock", {
      p_operation_id: crypto.randomUUID(),
      p_product_id: SEED_PRODUCT_ID,
      p_supplier_id: supplierId,
      p_quantity: 5,
      p_unit_cost: 280,
    });

    const sale = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 2, unitPrice: 500 });
    const { error } = await client.rpc("complete_sale", { p_operation_id: sale.operationId, p_sale: sale.sale, p_items: sale.items });
    expect(error).toBeNull();

    const { data: lines } = await client.from("sale_items").select("unit_price, unit_cost").eq("sale_id", sale.sale.id);
    expect(lines).toEqual([{ unit_price: 500, unit_cost: 280 }]);
  });
});
