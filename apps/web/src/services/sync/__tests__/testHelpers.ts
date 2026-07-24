import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Fixed local-dev-only credentials for the Supabase CLI's own managed
// Docker stack (`supabase start`, project_id "pene-pos-dev") -- same
// well-known anon key already committed in supabase/seed.sql's own comment
// ("public and safe to commit, unlike a service_role key... the fixed,
// well-known default for every local Supabase stack"). These tests are
// integration tests against that real local Postgres on purpose (no
// mocking), so they need a real client, not env-var plumbing through Vite's
// import.meta.env (which Vitest's node environment doesn't populate the
// same way the app does at runtime).
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:55321";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export function createLocalSupabaseClient() {
  return createClient<Database>(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY);
}

// Signs in as the dev admin seeded by supabase/seed.sql (admin@penepos.dev).
// Confirms every test in this suite runs under the same RLS/role context a
// real admin session would, not service_role (which would bypass RLS
// entirely and silently hide an RLS bug like the sync_operations
// insert-policy gap this rebuild already caught once during development).
export async function signInAsDevAdmin() {
  const client = createLocalSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: "admin@penepos.dev",
    password: "DevAdmin123!",
  });
  if (error || !data.session) {
    throw new Error(
      `Failed to sign in as dev admin -- is the local Supabase stack running (\`supabase start\`) and reset (\`supabase db reset\`)? ${error?.message}`,
    );
  }
  return { client, adminId: data.user!.id };
}

// Well-known seeded ids (supabase/seed.sql) -- fixed, not random, so both
// migrations and this test suite can rely on them existing.
export const SEED_PRODUCT_ID = "00000000-0000-0000-0000-000000000101"; // Coca-Cola 33cl, stock 40
export const SEED_LOW_STOCK_PRODUCT_ID = "00000000-0000-0000-0000-000000000104"; // Biscuits Choco, stock 2
export const SEED_ADMIN_ID = "00000000-0000-0000-0000-000000000001";

export async function createTestWallet(client: ReturnType<typeof createLocalSupabaseClient>, balance = 100) {
  const id = crypto.randomUUID();
  const { error } = await client
    .from("student_wallets")
    .insert({ id, student_name: "Test Student", badge_code: `TEST-${id.slice(0, 8)}`, balance });
  if (error) throw error;
  return id;
}

export function newSale(overrides: {
  id?: string;
  cashierId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  paymentMethod?: "cash" | "momo_mtn" | "momo_orange" | "student_wallet";
  studentId?: string | null;
}) {
  const saleId = overrides.id ?? crypto.randomUUID();
  const total = overrides.unitPrice * overrides.quantity;
  return {
    operationId: crypto.randomUUID(),
    sale: {
      id: saleId,
      cashier_id: overrides.cashierId,
      total_amount: total,
      payment_method: overrides.paymentMethod ?? "cash",
      student_id: overrides.studentId ?? null,
    },
    items: [
      {
        id: crypto.randomUUID(),
        sale_id: saleId,
        product_id: overrides.productId,
        quantity: overrides.quantity,
        unit_price: overrides.unitPrice,
      },
    ],
  };
}
