// Triggered by the shop_status Database Webhook (migration 00003) -- fired
// by supabase_functions.http_request, which builds the POST body from the
// trigger context as {type, table, schema, record, old_record}. This is a
// real Supabase mechanism, not a custom payload shape this function invents.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  if (!RESEND_API_KEY) {
    console.error("[notify-shop-status] RESEND_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "email-not-configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
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
  const { data: wallets, error } = await supabase
    .from("student_wallets")
    .select("email")
    .not("email", "is", null);

  if (error) {
    console.error("[notify-shop-status] failed to load student emails", error);
    return new Response(JSON.stringify({ error: "query-failed" }), { status: 500 });
  }

  const recipients = (wallets ?? [])
    .map((row) => row.email)
    .filter((email): email is string => Boolean(email));

  if (recipients.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

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
    return new Response(JSON.stringify({ error: "resend-failed" }), { status: 502 });
  }

  return new Response(JSON.stringify({ sent: recipients.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
