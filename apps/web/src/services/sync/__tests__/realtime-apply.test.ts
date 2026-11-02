import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyRealtimeChange } from "@/services/sync/realtimeApply";

// Phase 3 sync: Realtime payloads are written straight into Dexie, with the
// same "only accept if newer" rule as the pull.
const productRow = (overrides: Record<string, unknown> = {}) => ({
  id: "p-rt-1",
  name: "Realtime Cola",
  price: 500.5,
  stock: 10,
  barcode: null,
  category_id: null,
  image_url: null,
  emoji: "🥤",
  expiry_date: null,
  cost_price: 300,
  updated_at: "2026-11-02T10:00:00Z",
  deleted_at: null,
  sync_seq: 100,
  ...overrides,
});

describe("applyRealtimeChange", () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.sale_items.clear();
  });

  it("inserts a row from another till", async () => {
    expect(await applyRealtimeChange({ table: "products", eventType: "INSERT", new: productRow(), old: {} })).toBe(true);
    expect(await db.products.get("p-rt-1")).toMatchObject({ name: "Realtime Cola", price: 500.5, cost_price: 300, sync_seq: 100 });
  });

  it("ignores a stale or duplicate message (lower sync_seq)", async () => {
    await applyRealtimeChange({ table: "products", eventType: "UPDATE", new: productRow({ stock: 7, sync_seq: 120 }), old: { id: "p-rt-1" } });
    await applyRealtimeChange({ table: "products", eventType: "UPDATE", new: productRow({ stock: 99, sync_seq: 110 }), old: { id: "p-rt-1" } });
    expect((await db.products.get("p-rt-1"))?.stock).toBe(7);
  });

  it("treats a soft delete as a removal", async () => {
    await applyRealtimeChange({ table: "products", eventType: "INSERT", new: productRow(), old: {} });
    await applyRealtimeChange({
      table: "products",
      eventType: "UPDATE",
      new: productRow({ deleted_at: "2026-11-02T11:00:00Z", sync_seq: 130 }),
      old: { id: "p-rt-1" },
    });
    expect(await db.products.get("p-rt-1")).toBeUndefined();
  });

  it("applies sale lines too", async () => {
    const ok = await applyRealtimeChange({
      table: "sale_items",
      eventType: "INSERT",
      new: { id: "si-1", sale_id: "s-1", product_id: "p-rt-1", quantity: 2, unit_price: 12.5, unit_cost: 8, updated_at: "x", sync_seq: 140 },
      old: {},
    });
    expect(ok).toBe(true);
    expect(await db.sale_items.get("si-1")).toMatchObject({ quantity: 2, unit_price: 12.5, unit_cost: 8 });
  });

  it("refuses payloads it can't trust, so the caller falls back to a pull", async () => {
    expect(await applyRealtimeChange({ table: "suppliers", eventType: "INSERT", new: { id: "x", sync_seq: 1 }, old: {} })).toBe(false);
    expect(await applyRealtimeChange({ table: "products", eventType: "UPDATE", new: { id: "p-rt-1" }, old: {} })).toBe(false);
  });
});
