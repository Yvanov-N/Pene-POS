import { describe, expect, it } from "vitest";
import { signInAsDevAdmin, SEED_PRODUCT_ID } from "./testHelpers";

// supplier_price_history (migration 00038): a supplier's price for a product
// can change over time without losing the earlier prices.
describe("supplier price history", () => {
  it("keeps every price: restocks are logged under the operation id, manual updates append", async () => {
    const { client } = await signInAsDevAdmin();
    const supplierId = crypto.randomUUID();
    const { error: supplierError } = await client.from("suppliers").insert({ id: supplierId, name: `History ${supplierId.slice(0, 6)}` });
    expect(supplierError).toBeNull();

    const operationId = crypto.randomUUID();
    const { error: restockError } = await client.rpc("record_restock", {
      p_operation_id: operationId,
      p_product_id: SEED_PRODUCT_ID,
      p_supplier_id: supplierId,
      p_quantity: 6,
      p_unit_cost: 300,
    });
    expect(restockError).toBeNull();

    // The supplier later quotes a new price -- appended, not overwritten.
    const { error: manualError } = await client.from("supplier_price_history").insert({
      supplier_id: supplierId,
      product_id: SEED_PRODUCT_ID,
      price: 330,
      source: "manual",
    });
    expect(manualError).toBeNull();

    const { data: history } = await client
      .from("supplier_price_history")
      .select("id, price, source")
      .eq("supplier_id", supplierId)
      .order("recorded_at", { ascending: true });
    expect(history).toEqual([
      { id: operationId, price: 300, source: "restock" },
      expect.objectContaining({ price: 330, source: "manual" }),
    ]);
  });
});
