import { describe, expect, it } from "vitest";
import {
  buildPriceSeries,
  buildProductOffers,
  priceChangeByPurchase,
  summarizePurchases,
  summarizeSuppliers,
} from "../purchaseStats";
import type { StockPurchase, Supplier, SupplierProduct } from "@/types/db";

const NOW = "2026-11-01T00:00:00.000Z";

function supplier(id: string, name: string): Supplier {
  return { id, name, created_at: NOW, updated_at: NOW };
}

function offer(supplierId: string, productId: string, price: number): SupplierProduct {
  return { id: `${supplierId}-${productId}`, supplier_id: supplierId, product_id: productId, price, updated_at: NOW };
}

function purchase(id: string, productId: string, supplierId: string, quantity: number, unitCost: number, day: number): StockPurchase {
  const createdAt = `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
  return {
    id,
    product_id: productId,
    supplier_id: supplierId,
    quantity,
    unit_cost: unitCost,
    total_cost: quantity * unitCost,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const marche = supplier("s1", "Marché Mokolo");
const grossiste = supplier("s2", "Grossiste Akwa");
const idle = supplier("s3", "Sans activité");

describe("buildProductOffers", () => {
  it("ranks suppliers cheapest first and flags the best", () => {
    const rows = buildProductOffers(
      "p1",
      [marche, grossiste, idle],
      [offer("s1", "p1", 350), offer("s2", "p1", 300)],
      [purchase("a", "p1", "s1", 24, 360, 1)],
    );
    expect(rows.map((r) => r.supplier.id)).toEqual(["s2", "s1"]);
    expect(rows[0].isBest).toBe(true);
    expect(rows[1].isBest).toBe(false);
    expect(rows[1].lastPaid).toBe(360);
  });

  it("falls back to the last paid price when there is no offer", () => {
    const rows = buildProductOffers("p1", [marche], [], [
      purchase("a", "p1", "s1", 10, 400, 1),
      purchase("b", "p1", "s1", 10, 380, 5),
    ]);
    expect(rows[0].effectivePrice).toBe(380);
    expect(rows[0].purchaseCount).toBe(2);
  });
});

describe("summarizePurchases", () => {
  it("computes last, min, max and quantity-weighted average", () => {
    const summary = summarizePurchases([purchase("a", "p1", "s1", 10, 400, 1), purchase("b", "p1", "s2", 30, 300, 3)]);
    expect(summary).toMatchObject({ count: 2, totalQuantity: 40, totalSpent: 13000, lastCost: 300, minCost: 300, maxCost: 400 });
    expect(summary.averageCost).toBe(325);
  });

  it("handles no purchases", () => {
    expect(summarizePurchases([])).toEqual({ count: 0, totalQuantity: 0, totalSpent: 0 });
  });
});

describe("priceChangeByPurchase", () => {
  it("compares each purchase with the previous one of the same product", () => {
    const changes = priceChangeByPurchase([
      purchase("b", "p1", "s1", 10, 440, 5),
      purchase("a", "p1", "s2", 10, 400, 1),
      purchase("c", "p2", "s1", 10, 100, 2),
    ]);
    expect(changes.has("a")).toBe(false);
    expect(changes.get("b")).toBeCloseTo(10);
    expect(changes.has("c")).toBe(false);
  });
});

describe("buildPriceSeries", () => {
  it("returns chronological points keyed by supplier", () => {
    const series = buildPriceSeries("p1", [purchase("b", "p1", "s2", 1, 300, 5), purchase("a", "p1", "s1", 1, 350, 1)]);
    expect(series.supplierIds).toEqual(["s1", "s2"]);
    expect(series.points[0]).toMatchObject({ s1: 350 });
    expect(series.points[1]).toMatchObject({ s2: 300 });
  });
});

describe("summarizeSuppliers", () => {
  it("totals spend and counts products where the supplier is cheapest", () => {
    const summaries = summarizeSuppliers(
      [marche, grossiste, idle],
      [offer("s1", "p1", 350), offer("s2", "p1", 300), offer("s1", "p2", 100)],
      [purchase("a", "p1", "s1", 10, 350, 1)],
    );
    expect(summaries.get("s1")).toMatchObject({ purchaseCount: 1, totalSpent: 3500, productCount: 2, cheapestOn: 0 });
    expect(summaries.get("s2")).toMatchObject({ purchaseCount: 0, productCount: 1, cheapestOn: 1 });
    expect(summaries.get("s3")).toMatchObject({ purchaseCount: 0, productCount: 0, cheapestOn: 0 });
  });
});
