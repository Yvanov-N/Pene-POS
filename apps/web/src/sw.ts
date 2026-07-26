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
