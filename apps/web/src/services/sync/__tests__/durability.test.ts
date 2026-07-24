import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { commitLocal, makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";

// Regression test for Finding A (the "lost sale" root cause): the old
// usePosCheckout.ts awaited a direct Supabase call BEFORE ever touching
// Dexie, so a tab closing mid-await could lose a sale that may have already
// committed server-side. This proves the fix structurally: a mutation is
// fully durable in Dexie (business row + its outbox record, in the SAME
// transaction) the instant commitLocal()/the caller's own db.transaction()
// resolves, with zero dependency on any network call ever being attempted --
// pushOutbox is never even imported here.
describe("durability (commit-local-before-any-network-attempt)", () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.sync_outbox.clear();
  });

  it("commitLocal: the business write and its outbox record are both queryable immediately, with no network call involved at all", async () => {
    const productId = crypto.randomUUID();
    await db.products.put({ id: productId, name: "Test", price: 100, stock: 10, updated_at: new Date().toISOString() });

    const entry = makeOutboxEntry("generic_update", "products", { id: productId, stock: 9 });
    await commitLocal(db.products, () => db.products.update(productId, { stock: 9 }), entry);

    const product = await db.products.get(productId);
    expect(product?.stock).toBe(9);

    const outboxRows = await db.sync_outbox.where("operationId").equals(entry.operationId).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe("pending");
    expect(outboxRows[0].opType).toBe("generic_update");
  });

  it("a multi-table transaction (checkout's own shape) is all-or-nothing: a mid-transaction failure leaves neither the business write nor the outbox entry behind", async () => {
    const productId = crypto.randomUUID();
    await db.products.put({ id: productId, name: "Test", price: 100, stock: 10, updated_at: new Date().toISOString() });

    const entry = makeOutboxEntry("generic_update", "products", { id: productId, stock: -1 });

    await expect(
      db.transaction("rw", db.products, db.sync_outbox, async () => {
        await db.products.update(productId, { stock: -1 });
        await recordOutbox(entry);
        throw new Error("simulated failure after both writes queued, before commit");
      }),
    ).rejects.toThrow();

    const product = await db.products.get(productId);
    expect(product?.stock).toBe(10); // rolled back, not -1

    const outboxRows = await db.sync_outbox.where("operationId").equals(entry.operationId).toArray();
    expect(outboxRows).toHaveLength(0); // rolled back too -- no orphaned outbox entry
  });
});
