import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { makeOutboxEntry, recordOutbox, MAX_RETRIES } from "@/services/sync/outbox";
import { drainOutbox } from "@/services/sync/drain";
import { SEED_PRODUCT_ID } from "./testHelpers";

// Regression test: a stuck complete_sale in production never got retried
// again after 5 failed attempts, because the old drainOutbox() skipped any
// entry whose retryCount had reached MAX_RETRIES -- a cashier's sale then
// depended entirely on an admin noticing it in the Sync Health dashboard
// and clicking Retry, which is not what "sync with the db online when
// network comes back" means. drainOutbox must attempt every pending/error
// entry every time, with no retry ceiling.
describe("drainOutbox retries exhausted entries", () => {
  beforeEach(async () => {
    await db.sync_outbox.clear();
    await supabase.auth.signInWithPassword({ email: "admin@penepos.dev", password: "DevAdmin123!" });
    // pushOutbox() bails out early (returns "queued" without attempting
    // anything) when navigator.onLine is falsy -- in a real browser that's
    // true as long as there's any network interface, but Node's built-in
    // `navigator` has no `onLine` at all (reads as undefined/falsy), so it
    // needs stubbing here for pushOutbox to actually attempt the call.
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an entry with retryCount already past MAX_RETRIES is still attempted, not skipped", async () => {
    const marker = `retry-fix-${Date.now()}`;
    const entry = makeOutboxEntry("generic_update", "products", { id: SEED_PRODUCT_ID, image_url: marker });
    entry.retryCount = MAX_RETRIES + 5; // deliberately well past the old cap
    entry.status = "error";
    entry.errorMessage = "simulated prior failure";
    await db.transaction("rw", db.sync_outbox, async () => {
      await recordOutbox(entry);
    });

    await drainOutbox();

    const row = await db.sync_outbox.get(entry.id!);
    // If the old cap were still in effect, this entry would never have been
    // attempted at all and would still read status "error" with the same
    // retryCount -- it must have actually been pushed.
    expect(row?.status).toBe("synced");

    const { data } = await supabase.from("products").select("image_url").eq("id", SEED_PRODUCT_ID).single();
    expect(data?.image_url).toBe(marker);
  });
});
