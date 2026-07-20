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

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ url }) => url.pathname.startsWith("/rest/v1") || url.pathname.startsWith("/auth/v1"),
  new NetworkFirst({
    cacheName: "supabase-api-cache",
    networkTimeoutSeconds: 5,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

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
