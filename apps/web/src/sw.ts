/// <reference lib="webworker" />
// Custom service worker source (vite-plugin-pwa `injectManifest` strategy --
// required because a 'push' handler can't be added under the default
// `generateSW` strategy). Ports what generateSW previously auto-generated
// (precache/cleanup/runtime-caching, the SKIP_WAITING listener the existing
// update-notification flow depends on) and adds the new push handlers.

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { drainOutboxWith } from "@/services/sync/drainCore";
import { pushOutboxWith } from "@/services/sync/pushCore";
import {
  OUTBOX_SYNC_TAG,
  PENDING_SYNC_NOTIFICATION_TAG,
  SEND_NOW_ACTION,
  type PendingNotificationData,
} from "@/services/sync/syncTags";
import type { Database } from "@/types/supabase";

declare const self: ServiceWorkerGlobalScope;

// Workbox's own precache cache is already versioned/retired automatically by
// cleanupOutdatedCaches() below -- this is the one OTHER cache this SW
// writes to (the NetworkFirst route just under it), and NetworkFirst has no
// built-in expiration of its own. Without explicitly clearing it too, a
// stale /rest/v1 or /auth/v1 response could keep being served from here
// indefinitely, surviving every future app update -- see the "activate"
// listener at the bottom of this file, which drops it every time a new
// version of this worker takes over (i.e. every time "Update now" completes).
const API_CACHE_NAME = "supabase-api-cache";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// /auth/v1/health is deliberately excluded -- it's useNetworkStatus.ts's
// connectivity probe, whose entire purpose is "is the network reachable
// RIGHT NOW". NetworkFirst still falls back to a cached 200 after
// networkTimeoutSeconds even when the network genuinely fails (that's the
// whole point of NetworkFirst for real data routes), which would make the
// probe permanently report "reachable" from a stale cache entry the first
// time it ever succeeds -- confirmed live: isOnline stuck true while
// actually offline. It has to hit the real network, uncontrolled by this
// SW, every single time.
registerRoute(
  ({ url }) =>
    (url.pathname.startsWith("/rest/v1") || url.pathname.startsWith("/auth/v1")) && !url.pathname.endsWith("/health"),
  new NetworkFirst({
    cacheName: API_CACHE_NAME,
    networkTimeoutSeconds: 5,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

// Runs once per new version of this worker taking over -- a no-op the very
// first time this SW ever installs (nothing cached yet), and a full purge of
// the runtime API cache every time afterward, so "Update now" genuinely
// means every subsequent /rest/v1 and /auth/v1 read comes from the network
// fresh rather than whatever NetworkFirst happened to cache under the
// previous version. waitUntil holds activation open until this finishes, so
// it's guaranteed to complete before this worker starts controlling clients
// (and before the reload useAppUpdate.ts triggers on "controllerchange").
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete(API_CACHE_NAME));
});

// registerType: "prompt" means the app decides when to activate a waiting
// worker (via the "Update now" button -> updateServiceWorker(true) in
// useAppUpdate.ts) -- generateSW injected this listener automatically;
// injectManifest requires authoring it, and missing it would silently break
// that existing update flow.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

// Shown verbatim if the push payload isn't valid JSON at all -- deliberately
// NOT event.data.text(), which would surface whatever bytes actually failed
// to parse (could be truncated, binary, or from a misbehaving sender) as if
// it were a real message.
const FALLBACK_PAYLOAD: PushPayload = {
  title: "Cite Shop",
  body: "Nouveau message operationnel Cite Shop",
};

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = FALLBACK_PAYLOAD;

  if (event.data) {
    try {
      payload = { ...FALLBACK_PAYLOAD, ...event.data.json() };
    } catch {
      payload = FALLBACK_PAYLOAD;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? "/pwa-192x192.png",
      badge: payload.badge ?? "/pwa-192x192.png",
      // Sharing a tag collapses same-category alerts (e.g. every hourly
      // low-stock check) into one notification instead of stacking a new
      // one each time -- undefined is fine too (browser just never collapses).
      tag: payload.tag,
      requireInteraction: payload.requireInteraction ?? false,
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  // The unsent-sales reminder has its own handler (bottom of this file).
  if (event.notification.tag === PENDING_SYNC_NOTIFICATION_TAG) return;
  event.notification.close();
  const targetUrl = (event.notification.data as { url?: string } | undefined)?.url ?? "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of allClients) {
        if ("focus" in client) {
          const windowClient = await client.focus();
          if ("navigate" in windowClient) await windowClient.navigate(targetUrl);
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});

// ---- Background Sync: send queued sales while the app is closed ------------
//
// The page registers OUTBOX_SYNC_TAG whenever an outbox entry couldn't be
// sent (services/sync/push.ts). Chromium (Android) then fires "sync" here as
// soon as connectivity returns -- even with the app closed -- and retries a
// few times with backoff if this throws. Safari/iOS has no Background Sync:
// there the app's own sync on next open does it, as before.

interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

// Don't start a send with a token about to expire mid-request.
const TOKEN_MIN_VALIDITY_S = 60;

async function closePendingSyncNotifications(): Promise<void> {
  const notifications = await self.registration.getNotifications({ tag: PENDING_SYNC_NOTIFICATION_TAG });
  for (const notification of notifications) notification.close();
}

type WorkerDrainResult = "sent" | "unsent" | "no-session";

// Sends the outbox from the worker with the access token the page mirrored
// (lib/authSessionMirror.ts). Never refreshes it: rotating the refresh token
// from here would sign the app out. Expired -> "no-session", left for the app.
async function drainFromWorker(): Promise<WorkerDrainResult> {
  const session = await db.auth_session.get("current");
  if (!session || session.expires_at - TOKEN_MIN_VALIDITY_S < Date.now() / 1000) return "no-session";

  const client = createClient<Database>(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  await drainOutboxWith((entry) => pushOutboxWith(client, entry));

  const left = await db.sync_outbox.where("status").anyOf(["pending", "error"]).count();
  if (left === 0) await closePendingSyncNotifications();
  return left === 0 ? "sent" : "unsent";
}

async function backgroundDrain(): Promise<void> {
  // A visible app tab runs its own sync (and holds the same drain lock);
  // nothing to do from here.
  const windows = await self.clients.matchAll({ type: "window" });
  if (windows.some((client) => (client as WindowClient).visibilityState === "visible")) return;

  // Throwing tells the browser this sync didn't complete, so it retries later.
  if ((await drainFromWorker()) === "unsent") throw new Error("outbox entries still unsent");
}

self.addEventListener("sync", (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag !== OUTBOX_SYNC_TAG) return;
  syncEvent.waitUntil(backgroundDrain());
});

// ---- "Send" button on the unsent-sales reminder -----------------------------

async function openApp(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows[0] as WindowClient | undefined;
  if (existing) {
    await existing.focus();
    return;
  }
  await self.clients.openWindow(url);
}

async function sendNow(notification: Notification): Promise<void> {
  const data = notification.data as PendingNotificationData | undefined;
  const result = await drainFromWorker();

  if (result === "sent") {
    if (data) {
      const doneTag = `${PENDING_SYNC_NOTIFICATION_TAG}-done`;
      await self.registration.showNotification(data.texts.sentTitle, {
        body: data.texts.sentBody,
        tag: doneTag,
        icon: "/pwa-192x192.png",
        badge: "/pwa-192x192.png",
      });
      // A short confirmation, not something left in the shade.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      for (const done of await self.registration.getNotifications({ tag: doneTag })) done.close();
    }
    return;
  }

  if (result === "no-session") {
    // Session too old to use from here: the app sends everything on open.
    notification.close();
    await openApp(data?.url ?? "/");
    return;
  }

  // Still no network: keep the reminder (with its button) and let Background
  // Sync retry on its own once connectivity is back.
  await self.registration.showNotification(notification.title, {
    body: data?.texts.offlineBody ?? notification.body,
    tag: PENDING_SYNC_NOTIFICATION_TAG,
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    requireInteraction: true,
    data,
    actions: data ? [{ action: SEND_NOW_ACTION, title: data.texts.sendAction }] : [],
  } as NotificationOptions);
  await (self.registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync
    ?.register(OUTBOX_SYNC_TAG)
    .catch(() => undefined);
}

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  if (event.notification.tag !== PENDING_SYNC_NOTIFICATION_TAG) return;
  if (event.action === SEND_NOW_ACTION) {
    event.waitUntil(sendNow(event.notification));
    return;
  }
  // Tapping the notification body: open the app, which syncs on open.
  event.notification.close();
  const data = event.notification.data as PendingNotificationData | undefined;
  event.waitUntil(openApp(data?.url ?? "/"));
});
