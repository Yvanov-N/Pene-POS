import { describe, expect, it } from "vitest";
import { signInAsDevAdmin, SEED_PRODUCT_ID } from "./testHelpers";

// Regression test for a live production crash: complete_sale with a
// cashier_id that doesn't exist in profiles failed with a confusing 409
// whose message was about the sync_operations table, not sales --
// "insert or update on table \"sync_operations\" violates foreign key
// constraint ... Key is not present in table \"profiles\"." sales.cashier_id
// already has its own FK to profiles, so the INSERT INTO sales failed
// first, exactly as intended (a genuine conflict). But complete_sale's
// exception handler records that conflict by inserting into
// sync_operations with created_by = the same invalid cashier_id -- and
// that column ALSO had a profiles FK (migration 00024), so the ledger's
// own conflict-recording insert failed too, as an UNCAUGHT exception this
// time, masking the real, already-correctly-classified conflict behind an
// opaque crash on a table nobody but a developer knows exists. Migration
// 00031 drops both ledger FKs (sync_operations.created_by,
// sync_events.profile_id) -- diagnostic tables must always be able to
// record what happened, including exactly which id was invalid.
describe("ledger tables never crash the operation they're recording", () => {
  it("complete_sale with a nonexistent cashier_id returns a clean conflict, not an uncaught FK crash", async () => {
    const { client } = await signInAsDevAdmin();
    const bogusCashierId = crypto.randomUUID(); // guaranteed not to exist in profiles
    const saleId = crypto.randomUUID();
    const operationId = crypto.randomUUID();

    const result = await client.rpc("complete_sale", {
      p_operation_id: operationId,
      p_sale: {
        id: saleId,
        cashier_id: bogusCashierId,
        total_amount: 500,
        payment_method: "cash",
      },
      p_items: [
        { id: crypto.randomUUID(), sale_id: saleId, product_id: SEED_PRODUCT_ID, quantity: 1, unit_price: 500 },
      ],
    });

    // The old bug: this would come back as `error` (an uncaught Postgres
    // exception), not a clean RPC response.
    expect(result.error).toBeNull();
    expect((result.data as { outcome: string }).outcome).toBe("conflict");
    // Postgres names the violated constraint, not literally "profiles" --
    // this is the exact message that used to never reach the client at
    // all, replaced by an unrelated-looking crash on sync_operations.
    expect((result.data as { reason: string }).reason).toContain("sales_cashier_id_fkey");

    // No sale, no stock decrement -- the whole transaction rolled back,
    // same as before this fix. Only the *reporting* of that outcome was
    // broken, not the transactional correctness itself.
    const { data: sale } = await client.from("sales").select("id").eq("id", saleId).maybeSingle();
    expect(sale).toBeNull();

    // The ledger itself must have successfully recorded the conflict, with
    // the dangling id intact -- that's the whole point of dropping the FK.
    const { data: ledgerRow } = await client
      .from("sync_operations")
      .select("outcome,created_by")
      .eq("id", operationId)
      .single();
    expect(ledgerRow?.outcome).toBe("conflict");
    expect(ledgerRow?.created_by).toBe(bogusCashierId);
  });
});
