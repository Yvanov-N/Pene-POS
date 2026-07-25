import { describe, expect, it, beforeEach } from "vitest";
import { db, purgeMockSeedData } from "@/lib/db";
import { MOCK_CASHIER_EMAIL, CATEGORY_IDS, PRODUCT_IDS } from "@/lib/mockSeedIds";

// Regression test for a real production incident: seedLocalProfiles/
// Categories/Products ran unconditionally on every device (no dev-only
// gate), so a fresh production device could get seeded with a fake
// "cashier@penepos.test" profile and fixed-id mock categories/products that
// only ever existed in the local dev Supabase project. Any sale rung up
// under that fake identity/catalog was permanently unsyncable. This tests
// the cleanup function directly (not the import.meta.env.PROD gate around
// it, which decides whether it runs on a real device) -- it must remove
// exactly the known mock rows and leave everything else untouched.
describe("purgeMockSeedData", () => {
  beforeEach(async () => {
    await db.profiles.clear();
    await db.categories.clear();
    await db.products.clear();
  });

  it("removes the mock cashier profile but leaves other profiles alone", async () => {
    await db.profiles.bulkPut([
      {
        id: crypto.randomUUID(),
        email: MOCK_CASHIER_EMAIL,
        first_name: "Cashier",
        last_name: "Demo",
        full_name: "Cashier Demo",
        preferred_language: "fr",
        role: "cashier",
        pin_hash: "mock-hash",
      },
      {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@penepos.dev",
        first_name: "Dev",
        last_name: "Admin",
        full_name: "Dev Admin",
        preferred_language: "fr",
        role: "admin",
        pin_hash: "admin-hash",
      },
      {
        id: crypto.randomUUID(),
        email: "real.cashier@realshop.com",
        first_name: "Real",
        last_name: "Cashier",
        full_name: "Real Cashier",
        preferred_language: "fr",
        role: "cashier",
        pin_hash: "real-hash",
      },
    ]);

    await purgeMockSeedData({ profiles: db.profiles, categories: db.categories, products: db.products });

    const remaining = await db.profiles.toArray();
    expect(remaining.map((p) => p.email).sort()).toEqual(["admin@penepos.dev", "real.cashier@realshop.com"]);
  });

  it("removes only the fixed mock category/product ids, leaving real catalog rows intact", async () => {
    const realCategoryId = crypto.randomUUID();
    const realProductId = crypto.randomUUID();

    await db.categories.bulkPut([
      { id: CATEGORY_IDS.boissons, name: "Boissons", updated_at: new Date().toISOString() },
      { id: realCategoryId, name: "Real Category", updated_at: new Date().toISOString() },
    ]);
    await db.products.bulkPut([
      { id: PRODUCT_IDS.cola, name: "Coca-Cola 33cl", price: 500, stock: 40, updated_at: new Date().toISOString() },
      { id: realProductId, name: "Real Product", price: 999, stock: 5, updated_at: new Date().toISOString() },
    ]);

    await purgeMockSeedData({ profiles: db.profiles, categories: db.categories, products: db.products });

    const remainingCategories = await db.categories.toArray();
    const remainingProducts = await db.products.toArray();
    expect(remainingCategories.map((c) => c.id)).toEqual([realCategoryId]);
    expect(remainingProducts.map((p) => p.id)).toEqual([realProductId]);
  });
});
