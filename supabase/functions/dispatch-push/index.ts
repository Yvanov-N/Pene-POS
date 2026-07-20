// Generic, on-demand Web Push dispatcher -- the one thing inventory-alerts
// (cron-only) and notify-shop-status (webhook-only, shop_status writes only)
// can't do: send an arbitrary payload right now, to an arbitrary target.
// Its one real caller today is the Settings diagnostic tester ("Tester la
// notification Push"), invoked with the signed-in admin's own user id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { configureVapid, sendToSubscriptions, type PushNotificationPayload } from "../_shared/webpush.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface DispatchPushRequest {
  targetRole?: "admin" | "cashier";
  targetUserId?: string;
  payload: PushNotificationPayload;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method-not-allowed" }), { status: 405 });
  }

  if (!configureVapid()) {
    console.error("[dispatch-push] VAPID keys are not configured");
    return new Response(JSON.stringify({ error: "push-not-configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: DispatchPushRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid-json" }), { status: 400 });
  }

  if (!body.payload?.title || !body.payload?.body) {
    return new Response(JSON.stringify({ error: "missing-payload" }), { status: 400 });
  }

  // A browser can only ever call this with a real user's JWT (never the
  // service_role key, which is never shipped to a client) -- so an ordinary
  // caller is restricted to pushing to *their own* devices, never a role
  // broadcast or someone else's endpoint. Only a trusted server-side caller
  // presenting the actual service_role key (a future automated flow -- none
  // exists yet) can target a role or skip targeting entirely to broadcast
  // to every device.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  const isServiceRole = callerToken.length > 0 && callerToken === SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (!isServiceRole) {
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const requestedSomeoneElse = body.targetUserId && body.targetUserId !== callerData.user.id;
    if (body.targetRole || requestedSomeoneElse || !body.targetUserId) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }
  }

  let query = supabase.from("push_subscriptions").select("endpoint, p256dh, auth, profiles!inner(role)");
  if (body.targetUserId) {
    query = query.eq("user_id", body.targetUserId);
  } else if (body.targetRole) {
    query = query.eq("profiles.role", body.targetRole);
  }
  // else (service_role, no target at all): broadcast to every subscription.

  const { data: subscriptions, error: subsError } = await query;
  if (subsError) {
    console.error("[dispatch-push] failed to query subscriptions", subsError);
    return new Response(JSON.stringify({ error: "query-failed" }), { status: 500 });
  }

  if (!subscriptions || subscriptions.length === 0) {
    return new Response(JSON.stringify({ sent: 0, pruned: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { sent, pruned } = await sendToSubscriptions(supabase, subscriptions, body.payload);

  return new Response(JSON.stringify({ sent, pruned }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
