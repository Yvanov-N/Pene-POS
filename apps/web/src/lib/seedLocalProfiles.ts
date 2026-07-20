import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";
import { computeFullName } from "@/types/db";

// Mock local cashier/admin profiles for testing the PIN pad before Phase 3
// designs the real sync path (see the note on Profile in @/types/db).
// Test PINs: admin = 1234, cashier = 5678.
//
// The admin mock deliberately uses the SAME id as the real seeded Supabase
// admin (supabase/seed.sql: 00000000-0000-0000-0000-000000000001), not a
// random one. pullFromSupabase() already has logic to preserve whatever
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
// creates the admin), so the cashier mock still uses a random id -- a
// cashier-attributed action that requires its profile id to exist in
// Supabase would hit the same class of failure. Out of scope to fix here
// (would mean adding a real seeded cashier account), flagged for awareness.
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
      email: "cashier@penepos.test",
      first_name: "Cashier",
      last_name: "Demo",
      full_name: computeFullName("Cashier", "Demo"),
      preferred_language: "fr",
      role: "cashier",
      pin_hash: await hashPin("5678"),
    },
  ]);
}
