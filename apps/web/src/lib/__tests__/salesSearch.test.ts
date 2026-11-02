import { describe, expect, it } from "vitest";
import { matchesSaleSearch, type SaleSearchContext } from "../salesSearch";
import type { Sale } from "@/types/db";

const sale: Sale = {
  id: "8a6706aa-0000-0000-0000-000000000000",
  created_at: "2026-11-02T10:00:00.000Z",
  cashier_id: "cashier-1",
  device_label: "macos-yaounde",
  total_amount: 1000,
  payment_method: "student_wallet",
  student_id: "student-1",
  status: "completed",
  updated_at: "2026-11-02T10:00:00.000Z",
};

const context: SaleSearchContext = {
  cashierNames: new Map([["cashier-1", "Dev Admin"]]),
  studentNames: new Map([["student-1", "Awa Ngono"]]),
  saleIdsWithMatchingProduct: new Set(),
};

describe("matchesSaleSearch", () => {
  it("matches id, cashier, device and student", () => {
    expect(matchesSaleSearch(sale, "8a6706", context)).toBe(true);
    expect(matchesSaleSearch(sale, "dev admin", context)).toBe(true);
    expect(matchesSaleSearch(sale, "yaounde", context)).toBe(true);
    expect(matchesSaleSearch(sale, "awa", context)).toBe(true);
    expect(matchesSaleSearch(sale, "coca", context)).toBe(false);
  });

  it("matches a sale containing a matching product", () => {
    expect(matchesSaleSearch(sale, "coca", { ...context, saleIdsWithMatchingProduct: new Set([sale.id]) })).toBe(true);
  });

  it("matches everything on an empty term", () => {
    expect(matchesSaleSearch(sale, "", context)).toBe(true);
  });
});
