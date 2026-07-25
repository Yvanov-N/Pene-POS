// Shared identifiers for the DEV-only mock seed rows (seedLocalProfiles.ts,
// seedLocalCategories.ts, seedLocalProducts.ts) -- pulled into their own
// dependency-free module so lib/db.ts's production-only cleanup migration
// (version 10) can reference the exact same ids/marker without importing
// from those seed files directly, which would create a circular import
// (they each import `db` from lib/db.ts already).

export const MOCK_CASHIER_EMAIL = "cashier@penepos.test";

export const CATEGORY_IDS = {
  boissons: "00000000-0000-0000-0000-000000000201",
  snacks: "00000000-0000-0000-0000-000000000202",
  laiterie: "00000000-0000-0000-0000-000000000203",
  recharge: "00000000-0000-0000-0000-000000000204",
  epicerie: "00000000-0000-0000-0000-000000000205",
  hygiene: "00000000-0000-0000-0000-000000000206",
} as const;

export const PRODUCT_IDS = {
  cola: "00000000-0000-0000-0000-000000000101",
  water: "00000000-0000-0000-0000-000000000102",
  chips: "00000000-0000-0000-0000-000000000103",
  biscuits: "00000000-0000-0000-0000-000000000104",
  yogurt: "00000000-0000-0000-0000-000000000105",
  cheese: "00000000-0000-0000-0000-000000000106",
  momo: "00000000-0000-0000-0000-000000000107",
  sardine: "00000000-0000-0000-0000-000000000108",
  soap: "00000000-0000-0000-0000-000000000109",
} as const;
