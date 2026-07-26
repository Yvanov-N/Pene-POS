import { describe, expect, it } from "vitest";
import { signInAsDevAdmin, newSale, SEED_PRODUCT_ID, SEED_ADMIN_ID } from "./testHelpers";

// Checkout now attributes a sale to the device that rang it up
// (device_label), not to whichever admin's PIN happened to authorize it --
// cashier_id is kept purely as an audit trail of who authorized the
// checkout. This confirms complete_sale actually stores device_label, that
// it round-trips through get_public_receipt (the public/shared receipt
// path), and that omitting it (an older client, or a sale made before this
// feature existed) doesn't break anything -- it's simply null.
describe("sales.device_label", () => {
  it("complete_sale stores device_label, and get_public_receipt returns it alongside the still-recorded cashier_id", async () => {
    const { client } = await signInAsDevAdmin();
    const { operationId, sale, items } = newSale({
      cashierId: SEED_ADMIN_ID,
      productId: SEED_PRODUCT_ID,
      quantity: 1,
      unitPrice: 500,
    });

    const result = await client.rpc("complete_sale", {
      p_operation_id: operationId,
      p_sale: { ...sale, device_label: "macos-yaounde" },
      p_items: items,
    });
    expect(result.error).toBeNull();
    expect((result.data as { outcome: string }).outcome).toBe("completed");

    const { data: row, error } = await client
      .from("sales")
      .select("device_label,cashier_id")
      .eq("id", sale.id)
      .single();
    expect(error).toBeNull();
    expect(row?.device_label).toBe("macos-yaounde");
    expect(row?.cashier_id).toBe(SEED_ADMIN_ID); // still recorded, just no longer the primary display

    const receipt = await client.rpc("get_public_receipt", { p_sale_id: sale.id });
    expect(receipt.error).toBeNull();
    expect((receipt.data as { device_label: string }).device_label).toBe("macos-yaounde");
    expect((receipt.data as { cashier_name: string }).cashier_name).toBeTruthy();
  });

  it("omitting device_label leaves it null, without failing the sale", async () => {
    const { client } = await signInAsDevAdmin();
    const { operationId, sale, items } = newSale({
      cashierId: SEED_ADMIN_ID,
      productId: SEED_PRODUCT_ID,
      quantity: 1,
      unitPrice: 500,
    });

    const result = await client.rpc("complete_sale", {
      p_operation_id: operationId,
      p_sale: sale, // no device_label key at all
      p_items: items,
    });
    expect(result.error).toBeNull();
    expect((result.data as { outcome: string }).outcome).toBe("completed");

    const { data: row } = await client.from("sales").select("device_label").eq("id", sale.id).single();
    expect(row?.device_label).toBeNull();
  });
});
