import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { writeBackIfNewer } from "@/services/sync/pull";
import type { Product } from "@/types/db";

// Regression test for the sync engine's core clobber bug: the old
// pullFromSupabase() bulkPut every row it fetched unconditionally, with no
// "is this actually newer than what I already have" check at all -- a stale
// full-table page landing after a fresher local write could silently
// overwrite it. writeBackIfNewer (services/sync/pull.ts) is the shared
// merge rule that replaces that, used both by the main cursor-based pull and
// every one-off stale-while-revalidate fetch (ProductGrid, checkout's wallet
// search, ...).
describe("pull merge (only accept if newer, by sync_seq)", () => {
  beforeEach(async () => {
    await db.products.clear();
  });

  it("a stale incoming row (lower sync_seq) does not overwrite a fresher local row", async () => {
    const productId = crypto.randomUUID();
    await db.products.put({ id: productId, name: "Fresh Local Edit", price: 500, stock: 10, updated_at: "now", sync_seq: 42 });

    const staleRemoteRow = { id: productId, sync_seq: 10 };
    await writeBackIfNewer(
      db.products,
      [staleRemoteRow],
      (): Product => ({ id: productId, name: "Stale Server Value", price: 999, stock: 999, updated_at: "old", sync_seq: 10 }),
    );

    const after = await db.products.get(productId);
    expect(after?.name).toBe("Fresh Local Edit"); // NOT clobbered by the stale row
    expect(after?.sync_seq).toBe(42);
  });

  it("a newer incoming row (higher sync_seq) does overwrite the local row", async () => {
    const productId = crypto.randomUUID();
    await db.products.put({ id: productId, name: "Old Local Value", price: 500, stock: 10, updated_at: "old", sync_seq: 10 });

    const freshRemoteRow = { id: productId, sync_seq: 50 };
    await writeBackIfNewer(
      db.products,
      [freshRemoteRow],
      (): Product => ({ id: productId, name: "New Server Value", price: 600, stock: 5, updated_at: "new", sync_seq: 50 }),
    );

    const after = await db.products.get(productId);
    expect(after?.name).toBe("New Server Value");
    expect(after?.sync_seq).toBe(50);
  });

  it("a row with no local counterpart at all is always accepted regardless of its sync_seq", async () => {
    const productId = crypto.randomUUID();
    const remoteRow = { id: productId, sync_seq: 1 };
    await writeBackIfNewer(
      db.products,
      [remoteRow],
      (): Product => ({ id: productId, name: "Brand New", price: 100, stock: 1, updated_at: "now", sync_seq: 1 }),
    );

    const after = await db.products.get(productId);
    expect(after?.name).toBe("Brand New");
  });
});
