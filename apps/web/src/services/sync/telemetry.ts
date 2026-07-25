import { db } from "@/lib/db";
import { extractErrorMessage, makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import type { GenericMutationPayload } from "@/types/db";

// ============================================================================
// Diagnostic event log -- there is no error tracking anywhere in this app
// today; every sync bug fixed so far had to be found by reading code, not
// logs. logSyncEvent() records a warn/error-worthy breadcrumb through the
// SAME durable outbox every business mutation uses (a plain generic_insert
// targeting public.sync_events, migration 00025), so a crash log from a
// device that's offline right when it matters can't itself be lost -- it
// just rides along in the outbox until the next drain, same as any other
// pending mutation.
//
// Deliberately record-only, not eager-pushed, here: pushing immediately
// would require importing services/sync/push.ts, which itself imports this
// file to log RPC conflicts -- a circular dependency. Diagnostic logging has
// no urgency requirement business mutations do (fast "synced" confirmation,
// timely conflict detection), so relying on the periodic drain (up to 30s,
// or the next reconnect/manual sync) to eventually deliver it is an
// acceptable, deliberate trade-off, not an oversight.
// ============================================================================

const DEVICE_ID_KEY = "pene-pos-device-id";

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export interface SyncEventInput {
  eventType: string;
  severity: "warning" | "error";
  tableName?: string;
  entityId?: string;
  operationId?: string;
  message?: string;
  context?: Record<string, unknown>;
}

export async function logSyncEvent(input: SyncEventInput): Promise<void> {
  const payload: GenericMutationPayload = {
    id: crypto.randomUUID(),
    device_id: getDeviceId(),
    event_type: input.eventType,
    severity: input.severity,
    entity_table: input.tableName ?? null,
    entity_id: input.entityId ?? null,
    operation_id: input.operationId ?? null,
    message: input.message ?? null,
    context: input.context ?? null,
  };

  const entry = makeOutboxEntry("generic_insert", "sync_events", payload);
  await db.transaction("rw", db.sync_outbox, async () => {
    await recordOutbox(entry);
  });
}

// Wires window.onerror/onunhandledrejection so an uncaught exception
// anywhere in the app leaves a durable trace instead of only a browser
// console line nobody but a developer actively watching that one device
// ever sees -- directly closes the "zero telemetry today" gap.
export function installGlobalErrorTelemetry(): void {
  window.addEventListener("error", (event) => {
    void logSyncEvent({
      eventType: "uncaught_exception",
      severity: "error",
      message: event.message,
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    void logSyncEvent({
      eventType: "unhandled_rejection",
      severity: "error",
      message: extractErrorMessage(reason),
    });
  });
}
