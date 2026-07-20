import { db } from "@/lib/db";
import type { Category } from "@/types/db";

const now = new Date().toISOString();

// Fixed ids, not crypto.randomUUID() -- must match the rows seeded
// server-side in supabase/seed.sql (same fixed-id convention as
// seedLocalProducts.ts / seedLocalProfiles.ts). seedLocalProducts.ts
// imports these to set each mock product's category_id.
export const CATEGORY_IDS = {
  boissons: "00000000-0000-0000-0000-000000000201",
  snacks: "00000000-0000-0000-0000-000000000202",
  laiterie: "00000000-0000-0000-0000-000000000203",
  recharge: "00000000-0000-0000-0000-000000000204",
  epicerie: "00000000-0000-0000-0000-000000000205",
  hygiene: "00000000-0000-0000-0000-000000000206",
} as const;

const MOCK_CATEGORIES: Category[] = [
  { id: CATEGORY_IDS.boissons, name: "Boissons", updated_at: now },
  { id: CATEGORY_IDS.snacks, name: "Snacks", updated_at: now },
  { id: CATEGORY_IDS.laiterie, name: "Laiterie", updated_at: now },
  { id: CATEGORY_IDS.recharge, name: "Recharge", updated_at: now },
  { id: CATEGORY_IDS.epicerie, name: "Epicerie", updated_at: now },
  { id: CATEGORY_IDS.hygiene, name: "Hygiene", updated_at: now },
];

// Same StrictMode double-invoke guard as seedLocalProfiles.ts -- caches the
// in-flight promise so a concurrent second call awaits the first instead of
// racing its own count()-then-bulkPut() check.
let seedingPromise: Promise<void> | null = null;

export async function seedLocalCategories(): Promise<void> {
  if (!seedingPromise) {
    seedingPromise = seedLocalCategoriesInternal();
  }
  return seedingPromise;
}

async function seedLocalCategoriesInternal(): Promise<void> {
  const existing = await db.categories.count();
  if (existing > 0) return;
  await db.categories.bulkPut(MOCK_CATEGORIES);
}
