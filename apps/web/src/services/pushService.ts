import { supabase } from "@/lib/supabase";

// Standard VAPID key conversion: PushManager.subscribe wants the
// applicationServerKey as a Uint8Array, but VAPID public keys are shared as
// a base64url string.
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// iOS Safari only exposes the Push API at all once the site has been added
// to the Home Screen (running in its own standalone window, not a browser
// tab) -- `Notification`/`PushManager` are simply undefined otherwise, which
// isPushSupported() alone can't distinguish from "this browser never
// supports push" (desktop Firefox pre-2016, say). navigator.standalone is
// iOS Safari's own (non-standard) property for this; display-mode is the
// portable equivalent every other installed-PWA context sets.
function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type PushPermissionStatus = NotificationPermission | "unsupported" | "ios-install-required";

// The richer status NotificationSettingsCard actually needs to explain
// *why* push isn't available -- "denied" and "you haven't installed this as
// an app yet" call for two completely different instructions to the admin.
export function checkPermission(): PushPermissionStatus {
  if (isIosDevice() && !isStandaloneDisplay()) return "ios-install-required";
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";
  return Notification.requestPermission();
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}

export async function subscribeToPush(vapidPublicKey: string): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("push-unsupported");
  }

  const permission = await requestNotificationPermission();
  if (permission !== "granted") {
    throw new Error("push-permission-denied");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("push-no-session");

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("push-subscription-incomplete");
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      // Not identity, just a hint for a future "N devices linked" admin ever
      // wants to tell apart -- re-subscribing on the same browser overwrites
      // it with the same value anyway (onConflict: user_id,endpoint below).
      device_label: navigator.userAgent,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) throw error;
}

// Powers NotificationSettingsCard's "N appareils lies" line -- distinct from
// isPushSubscribed() above, which only ever answers for *this* browser.
export async function getSubscriptionCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);
  }
}
