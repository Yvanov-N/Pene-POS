import { supabase } from "@/lib/supabase";
import { logSyncEvent } from "@/services/sync/telemetry";
import { requestBackgroundSync } from "@/services/sync/backgroundSync";
import { pushOutboxWith } from "@/services/sync/pushCore";
import type { OutboxOperation, PushOutcome } from "@/types/db";

// Page-side push: the shared logic (pushCore.ts) with this tab's signed-in
// Supabase client, conflicts logged to sync_events, and -- when the entry
// couldn't be sent now -- a Background Sync request so the service worker can
// send it as soon as the network is back, even if the app gets closed.
export async function pushOutbox(entry: OutboxOperation): Promise<PushOutcome> {
  const outcome = await pushOutboxWith(supabase, entry, (info) =>
    logSyncEvent({ ...info, severity: "warning" }),
  );
  if (outcome === "queued") void requestBackgroundSync();
  return outcome;
}
