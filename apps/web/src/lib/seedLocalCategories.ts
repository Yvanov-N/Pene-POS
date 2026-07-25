import { db } from "@/lib/db";
import { CATEGORY_IDS } from "@/lib/mockSeedIds";
import type { Category } from "@/types/db";

const now = new Date().toISOString();

// DEV-ONLY -- the caller (AppShell.tsx) must gate this behind
// import.meta.env.DEV. These fixed ids only match rows that exist in the
// LOCAL dev Supabase project (supabase/seed.sql) -- there was no such gate
// for a long time, so a fresh production device would seed these straight
// into its local Dexie categories table before its first real pull, none
// of which correspond to any real production category. lib/db.ts's version
// 10 migration (production-only) removes any already-cached copy from
// devices that got poisoned before this gate existed.
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
