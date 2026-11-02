import { describe, expect, it } from "vitest";
import { totalsByProduct } from "../salesAggregation";
import type { SaleItem } from "@/types/db";

function item(productId: string, quantity: number, unitPrice: number, unitCost?: number): SaleItem {
  return {
    id: crypto.randomUUID(),
    sale_id: "s",
    product_id: productId,
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    updated_at: "2026-11-01T00:00:00.000Z",
  };
}

describe("totalsByProduct", () => {
  it("computes cost and profit from each line's snapshotted cost", () => {
    const totals = totalsByProduct([item("p1", 2, 500, 350), item("p1", 1, 500, 300)]);
    expect(totals.get("p1")).toEqual({
      quantitySold: 3,
      revenue: 1500,
      costedRevenue: 1500,
      cost: 1000,
      profit: 500,
      uncostedQuantity: 0,
    });
  });

  it("keeps lines with unknown cost out of profit", () => {
    const totals = totalsByProduct([item("p1", 2, 500), item("p1", 1, 500, 400)]);
    expect(totals.get("p1")).toMatchObject({ revenue: 1500, costedRevenue: 500, cost: 400, profit: 100, uncostedQuantity: 2 });
  });
});
