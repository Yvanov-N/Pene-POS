import { db } from "@/lib/db";
import { CATEGORY_IDS, PRODUCT_IDS } from "@/lib/mockSeedIds";
import type { Product } from "@/types/db";

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

const now = new Date().toISOString();

// DEV-ONLY -- the caller (AppShell.tsx) must gate this behind
// import.meta.env.DEV. Fixed ids, not crypto.randomUUID() -- these must
// match the rows seeded server-side in supabase/seed.sql (same convention
// as the dev admin's 00000000-0000-0000-0000-000000000001 in
// seedLocalProfiles.ts). Random ids here were a real, silent bug: every
// checkout's sale_items push has been failing sale_items_product_id_fkey
// (23503) since the sync engine was built, because Supabase's products
// table has never had a single row -- nothing in seed.sql ever inserted
// one. The push retries 5 times then sits at status "failed" forever,
// invisible to the AdminConflictDashboard (which only watches
// "conflict_warning"). Only surfaced now because Phase 9.1's public
// receipt RPC is the first thing that reads sale data back out of Supabase
// and visibly shows the gap (an items-less receipt).
//
// This also went unguarded for production for a long time: these ids only
// match the LOCAL dev Supabase project, so a fresh production device would
// seed these fake products (before its first real pull) with ids that
// don't correspond to anything in the production database. lib/db.ts's
// version 10 migration (production-only) removes any already-cached copy.
const MOCK_PRODUCTS: Product[] = [
  {
    id: PRODUCT_IDS.cola,
    name: "Coca-Cola 33cl",
    price: 500,
    stock: 40,
    barcode: "6001234567890",
    category_id: CATEGORY_IDS.boissons,
    emoji: "🥤",
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.water,
    name: "Eau minerale 50cl",
    price: 300,
    stock: 60,
    barcode: "6001234567891",
    category_id: CATEGORY_IDS.boissons,
    emoji: "💧",
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.chips,
    name: "Chips Plantain",
    price: 400,
    stock: 25,
    barcode: "6001234567892",
    category_id: CATEGORY_IDS.snacks,
    emoji: "🍟",
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.biscuits,
    name: "Biscuits Choco",
    price: 350,
    stock: 2,
    barcode: "6001234567893",
    category_id: CATEGORY_IDS.snacks,
    emoji: "🍪",
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.yogurt,
    name: "Yaourt Nature",
    price: 450,
    stock: 15,
    barcode: "6001234567894",
    category_id: CATEGORY_IDS.laiterie,
    emoji: "🥛",
    expiry_date: daysFromNow(3),
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.cheese,
    name: "Fromage Fondu",
    price: 600,
    stock: 10,
    barcode: "6001234567895",
    category_id: CATEGORY_IDS.laiterie,
    emoji: "🧀",
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.momo,
    name: "Recharge MoMo 1000F",
    price: 1000,
    stock: 999,
    barcode: "6001234567896",
    category_id: CATEGORY_IDS.recharge,
    emoji: "💳",
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.sardine,
    name: "Sardine Boite",
    price: 550,
    stock: 12,
    barcode: "6001234567897",
    category_id: CATEGORY_IDS.epicerie,
    emoji: "🐟",
    updated_at: now,
  },
  {
    id: PRODUCT_IDS.soap,
    name: "Savon",
    price: 250,
    stock: 0,
    barcode: "6001234567898",
    category_id: CATEGORY_IDS.hygiene,
    emoji: "🧼",
    updated_at: now,
  },
];

export async function seedLocalProducts(): Promise<void> {
  const existing = await db.products.count();
  if (existing > 0) return;
  await db.products.bulkPut(MOCK_PRODUCTS);
}
