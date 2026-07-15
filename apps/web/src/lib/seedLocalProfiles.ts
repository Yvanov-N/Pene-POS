import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";

// Mock local cashier/admin profiles for testing the PIN pad before Phase 3
// designs the real sync path (see the note on Profile in @/types/db).
// Test PINs: admin = 1234, cashier = 5678.
export async function seedLocalProfiles(): Promise<void> {
  const existing = await db.profiles.count();
  if (existing > 0) return;

  await db.profiles.bulkPut([
    {
      id: crypto.randomUUID(),
      email: "admin@penepos.test",
      full_name: "Admin Demo",
      role: "admin",
      pin_hash: await hashPin("1234"),
    },
    {
      id: crypto.randomUUID(),
      email: "cashier@penepos.test",
      full_name: "Cashier Demo",
      role: "cashier",
      pin_hash: await hashPin("5678"),
    },
  ]);
}
