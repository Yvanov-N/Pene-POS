import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import { PENDING_SYNC_NOTIFICATION_TAG } from "@/services/sync/syncTags";
import { usePageVisible } from "./usePageVisible";

// After this long unsent while online, it's no longer "about to go out".
const STUCK_AFTER_MS = 20000;

export interface PendingSyncState {
  count: number;
  sales: number;
  // Waiting long enough (or offline) that the user should be told.
  stuck: boolean;
}

// What's still in the outbox (telemetry rows excluded -- not user data), plus
// the reminders that keep it from being forgotten on a phone:
//   * the browser's "leave this page?" prompt while anything is unsent;
//   * a system notification when the app goes to the background with unsent
//     work (if notifications are allowed), cleared once it's all sent.
export function usePendingSync(isOnline: boolean): PendingSyncState {
  const { t } = useTranslation();
  const visible = usePageVisible();
  const entries = useLiveQuery(
    () =>
      db.sync_outbox
        .where("status")
        .anyOf(["pending", "syncing", "error"])
        .filter((entry) => entry.tableName !== "sync_events")
        .toArray(),
    [],
  );
  const count = entries?.length ?? 0;
  const sales = entries?.filter((entry) => entry.opType === "complete_sale").length ?? 0;
  const oldest = (entries ?? []).reduce<string | null>(
    (min, e) => (min === null || e.createdAt < min ? e.createdAt : min),
    null,
  );

  // Re-evaluate "stuck" as time passes, but only while something is pending.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (count === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [count]);
  const stuck = count > 0 && (!isOnline || (oldest !== null && now - new Date(oldest).getTime() > STUCK_AFTER_MS));

  useEffect(() => {
    if (count === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers need returnValue set; the text itself isn't shown.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready
      .then(async (registration) => {
        const open = await registration.getNotifications({ tag: PENDING_SYNC_NOTIFICATION_TAG });
        if (visible || count === 0) {
          for (const notification of open) notification.close();
          return;
        }
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const title =
          sales > 0
            ? t("sync.pendingNotificationTitleSales", { count: sales })
            : t("sync.pendingNotificationTitle", { count });
        await registration.showNotification(title, {
          body: t("sync.pendingNotificationBody"),
          tag: PENDING_SYNC_NOTIFICATION_TAG,
          icon: "/pwa-192x192.png",
          badge: "/pwa-192x192.png",
          data: { url: "/" },
        });
      })
      .catch(() => {
        // No service worker (dev without SW) -- the in-app banner still shows.
      });
  }, [visible, count, sales, t]);

  return { count, sales, stuck };
}
