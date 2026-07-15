// Local-only hash for offline PIN checks against the Dexie `profiles` cache
// -- not a substitute for the server's bcrypt pin_code hash (see
// supabase/migrations/00001_initial_schema.sql), just a way to avoid
// storing raw 4-digit PINs in IndexedDB.
export async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
