import { OUTBOX_SYNC_TAG } from "@/services/sync/syncTags";

// Background Sync (Chromium/Android only -- not Safari/iOS): asks the browser
// to wake the service worker once connectivity is back, even if the app has
// been closed, so queued sales reach the server without waiting for the app
// to be reopened. See the "sync" handler in src/sw.ts.

interface SyncManagerLike {
  register(tag: string): Promise<void>;
}

export async function requestBackgroundSync(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & { sync?: SyncManagerLike }).sync;
    if (!sync) return;
    await sync.register(OUTBOX_SYNC_TAG);
  } catch {
    // Unsupported, denied or in a private window: the app's own sync on
    // next open still sends everything.
  }
}
