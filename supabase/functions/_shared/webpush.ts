// Shared between inventory-alerts, notify-shop-status, and dispatch-push --
// all three send Web Push to some slice of push_subscriptions and all three
// need the exact same reliability rule: a push service returning 404/410
// means that endpoint is permanently gone (uninstalled, cleared site data,
// revoked permission), so the row must be pruned immediately rather than
// left to fail forever on every future send.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Mirrors the PushPayload shape sw.ts's 'push' listener parses -- keep the
// two in sync by hand (a Deno function and a browser service worker can't
// share a source file across that boundary).
export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

let vapidConfigured = false;

// Idempotent (safe to call once per invocation from every caller) --
// webpush.setVapidDetails is process-global module state, and Deno's edge
// runtime can reuse an isolate across invocations.
export function configureVapid(): boolean {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return false;

  if (!vapidConfigured) {
    const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@citeshop.app";
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
  return true;
}

export interface SendResult {
  sent: number;
  pruned: number;
}

export async function sendToSubscriptions(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  subscriptions: PushSubscriptionRow[],
  payload: PushNotificationPayload,
): Promise<SendResult> {
  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          body,
        );
        sent++;
        // Best-effort freshness marker -- a failed update here shouldn't
        // fail the send itself, so it's deliberately not awaited-and-thrown.
        await supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("endpoint", subscription.endpoint);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          pruned++;
          await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        } else {
          console.warn("[webpush] send failed for", subscription.endpoint, statusCode, error);
        }
      }
    }),
  );

  return { sent, pruned };
}
