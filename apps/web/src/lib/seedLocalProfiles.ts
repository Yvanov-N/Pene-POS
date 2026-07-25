import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";
import { MOCK_CASHIER_EMAIL } from "@/lib/mockSeedIds";
import { computeFullName } from "@/types/db";

// Mock local cashier/admin profiles for testing the PIN pad before Phase 3
// designs the real sync path (see the note on Profile in @/types/db).
// Test PINs: admin = 1234, cashier = 5678.
//
// DEV-ONLY -- the caller (AppShell.tsx) must gate this behind
// import.meta.env.DEV. This was NOT enforced for a long time and caused a
// real production incident: with no gate, this ran on every device
// (production included), and on a brand-new device -- before its first
// real profiles pull ever completed -- it happily seeded this fake
// "cashier@penepos.test" mock with a random id straight into a production
// Dexie database. Any sale rung up under that PIN got a cashier_id that
// was never a real row in the production profiles table, and complete_sale
// correctly rejected it every time (sales_cashier_id_fkey) -- forever,
// since the id was never going to become real. lib/db.ts's version 10
// migration (production-only) purges any already-cached copy of this
// specific mock row from devices that got poisoned before this gate
// existed.
//
// The admin mock deliberately uses the SAME id as the real seeded Supabase
// admin (supabase/seed.sql: 00000000-0000-0000-0000-000000000001), not a
// random one. pullAll() (services/sync/pull.ts) already has logic to preserve whatever
// pin_hash a local profile row has when it re-pulls that same row ("a
// brand-new pulled profile has none yet and fails closed... an empty string
// never matches a real digest") -- but that preservation is keyed by id, so
// it silently never engaged while the mock lived at a different, random id:
// the REAL admin row's pin_hash stayed permanently "" (never matching any
// PIN), while PIN checks always matched the mock's row instead. That's fine
// for local dev PIN entry, but it meant every admin-authenticated action
// used a profile id that doesn't actually exist in Supabase -- invisible
// until a foreign key requiring that id (e.g. shop_status.updated_by,
// migration 6) rejected it outright. Aligning the id makes both processes
// converge on one real row with a working local pin_hash, matching how the
// preserve-on-pull logic was already designed to work.
//
// No real cashier account is seeded server-side at all (seed.sql only
// creates the admin), so the cashier mock still uses a random id -- fine
// now that this is dev-only (nothing here needs to resolve against a real
// Supabase row, unlike the admin id), but see the production incident note
// above for what happens if this ever runs outside dev again.
const REAL_SEEDED_ADMIN_ID = "00000000-0000-0000-0000-000000000001";

// React StrictMode double-invokes effects in dev, which could otherwise race
// two concurrent calls past the count()-then-bulkPut() check before either
// finishes writing -- the cashier mock's random id means that's not a
// harmless duplicate upsert the way the id-aligned admin row is. Caching the
// in-flight promise makes a second concurrent call just await the first.
let seedingPromise: Promise<void> | null = null;

export async function seedLocalProfiles(): Promise<void> {
  if (!seedingPromise) {
    seedingPromise = seedLocalProfilesInternal();
  }
  return seedingPromise;
}

async function seedLocalProfilesInternal(): Promise<void> {
  const existing = await db.profiles.count();
  if (existing > 0) return;

  await db.profiles.bulkPut([
    {
      id: REAL_SEEDED_ADMIN_ID,
      email: "admin@penepos.dev",
      first_name: "Dev",
      last_name: "Admin",
      full_name: computeFullName("Dev", "Admin"),
      preferred_language: "fr",
      role: "admin",
      pin_hash: await hashPin("1234"),
    },
    {
      id: crypto.randomUUID(),
      email: MOCK_CASHIER_EMAIL,
      first_name: "Cashier",
      last_name: "Demo",
      full_name: computeFullName("Cashier", "Demo"),
      preferred_language: "fr",
      role: "cashier",
      pin_hash: await hashPin("5678"),
    },
  ]);
}
