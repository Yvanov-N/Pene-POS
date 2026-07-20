// Triggered by the shop_status Database Webhook (migration 00003) -- fired
// by supabase_functions.http_request, which builds the POST body from the
// trigger context as {type, table, schema, record, old_record}. This is a
// real Supabase mechanism, not a custom payload shape this function invents.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { configureVapid, sendToSubscriptions } from "../_shared/webpush.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Must be a domain verified in the Resend account this key belongs to --
// replace before deploying for real.
const FROM_ADDRESS = "Cite Shop <notifications@citeshop.app>";

interface ShopStatusWebhookPayload {
  type: string;
  table: string;
  schema: string;
  record: { id: number; is_open: boolean; updated_at: string; updated_by: string | null };
  old_record: { id: number; is_open: boolean } | null;
}

function buildEmail(isOpen: boolean): { subject: string; html: string } {
  const accent = isOpen ? "#16a34a" : "#dc2626";
  const emoji = isOpen ? "🟢" : "🔴";
  const headline = isOpen ? "Cite Shop est maintenant OUVERT !" : "Cite Shop est FERME";
  const body = isOpen
    ? "Venez faire vos achats sur le campus."
    : "Merci de votre visite et a tres bientot !";

  const html = `
    <div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background: #ffffff;">
      <div style="height: 6px; background: ${accent};"></div>
      <div style="padding: 32px 24px; text-align: center;">
        <div style="font-size: 44px; margin-bottom: 12px;">${emoji}</div>
        <h1 style="font-size: 20px; color: #0a0a0a; margin: 0 0 12px;">${headline}</h1>
        <p style="font-size: 15px; color: #444444; line-height: 1.5; margin: 0;">${body}</p>
      </div>
      <div style="padding: 16px 24px; border-top: 1px solid #eeeeee; text-align: center;">
        <p style="font-size: 12px; color: #999999; margin: 0;">Cite Shop / Pene POS</p>
      </div>
    </div>
  `;

  return { subject: headline, html };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method-not-allowed" }), { status: 405 });
  }

  let payload: ShopStatusWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid-json" }), { status: 400 });
  }

  const isOpen = payload.record?.is_open;
  if (typeof isOpen !== "boolean") {
    return new Response(JSON.stringify({ error: "missing-is_open" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Two independent broadcasts off the same event -- students get an email
  // (they have no app installed to push to), staff get a push (an inbox
  // they may not check between shifts isn't useful for "the shop just
  // opened"). Neither's failure/misconfiguration should block the other.
  const emailSent = await notifyStudentsByEmail(supabase, isOpen);
  const { sent: pushSent, pruned: pushPruned } = await notifyStaffByPush(supabase, isOpen);

  return new Response(JSON.stringify({ emailSent, pushSent, pushPruned }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function notifyStudentsByEmail(
  // deno-lint-ignore no-explicit-any
  supabase: ReturnType<typeof createClient<any>>,
  isOpen: boolean,
): Promise<number> {
  if (!RESEND_API_KEY) {
    console.warn("[notify-shop-status] RESEND_API_KEY is not configured -- skipping student email");
    return 0;
  }

  const { data: wallets, error } = await supabase
    .from("student_wallets")
    .select("email")
    .not("email", "is", null)
    .eq("email_opt_in", true);

  if (error) {
    console.error("[notify-shop-status] failed to load student emails", error);
    return 0;
  }

  const recipients = (wallets ?? [])
    .map((row: { email: string | null }) => row.email)
    .filter((email: string | null): email is string => Boolean(email));

  if (recipients.length === 0) return 0;

  const { subject, html } = buildEmail(isOpen);

  // bcc, not to -- a broadcast must never expose every recipient's address
  // to every other recipient.
  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: FROM_ADDRESS,
      bcc: recipients,
      subject,
      html,
    }),
  });

  if (!resendResponse.ok) {
    const detail = await resendResponse.text();
    console.error("[notify-shop-status] Resend request failed", resendResponse.status, detail);
    return 0;
  }

  return recipients.length;
}

async function notifyStaffByPush(
  // deno-lint-ignore no-explicit-any
  supabase: ReturnType<typeof createClient<any>>,
  isOpen: boolean,
): Promise<{ sent: number; pruned: number }> {
  if (!configureVapid()) {
    console.warn("[notify-shop-status] VAPID keys are not configured -- skipping staff push");
    return { sent: 0, pruned: 0 };
  }

  // No role filter -- both admin and cashier act on shop open/close (a
  // cashier clocking in needs to know just as much as an admin does), unlike
  // inventory-alerts which is admin-only restocking/collections work.
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");

  if (error) {
    console.error("[notify-shop-status] failed to query staff subscriptions", error);
    return { sent: 0, pruned: 0 };
  }

  return sendToSubscriptions(supabase, subscriptions ?? [], {
    title: isOpen ? "Boutique ouverte" : "Boutique fermee",
    body: isOpen ? "La boutique vient d'ouvrir." : "La boutique vient de fermer.",
    url: "/",
    tag: "shop-status",
  });
}
