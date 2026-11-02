import { describe, expect, it } from "vitest";
import { newSale, signInAsDevAdmin, SEED_PRODUCT_ID } from "./testHelpers";

// sales_search (migration 00037): sales history can be searched by the name
// of a product on the sale, server-side, in the same paginated query.
describe("sales_search view", () => {
  it("exposes product names so a sale is found by product", async () => {
    const { client, adminId } = await signInAsDevAdmin();
    const { data: product } = await client.from("products").select("name").eq("id", SEED_PRODUCT_ID).single();

    const sale = newSale({ cashierId: adminId, productId: SEED_PRODUCT_ID, quantity: 1, unitPrice: 500 });
    const { error } = await client.rpc("complete_sale", { p_operation_id: sale.operationId, p_sale: sale.sale, p_items: sale.items });
    expect(error).toBeNull();

    const fragment = product!.name.slice(0, 4);
    const { data, error: searchError } = await client
      .from("sales_search")
      .select("id, product_names")
      .eq("id", sale.sale.id)
      .or(`id_text.ilike.%zzzz-no-match%,product_names.ilike.%${fragment}%`);
    expect(searchError).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].product_names).toContain(product!.name);
  });
});
