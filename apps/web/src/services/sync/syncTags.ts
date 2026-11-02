// Shared between the page and the service worker (src/sw.ts).

// Background Sync registration tag for "the outbox has entries to send".
export const OUTBOX_SYNC_TAG = "pene-pos-outbox";

// Notification tag for the "sales not sent yet" reminder (one at a time;
// closed by whichever side sees the outbox empty again).
export const PENDING_SYNC_NOTIFICATION_TAG = "pene-pos-pending-sync";

// Action button on that reminder: send the outbox right now.
export const SEND_NOW_ACTION = "send-now";

// The service worker has no i18n -- the page passes the texts it may need to
// update the reminder after a "send now" attempt, in the current language.
export interface PendingNotificationData {
  url: string;
  texts: {
    sendAction: string;
    sentTitle: string;
    sentBody: string;
    offlineBody: string;
  };
}
