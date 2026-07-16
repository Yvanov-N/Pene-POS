// Invoked hourly by pg_cron + pg_net (migration 00003) -- also safe to call
// directly (idempotent: does nothing if nothing is critical).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");

const LOW_STOCK_THRESHOLD = 3;
const EXPIRY_WARNING_DAYS = 7;

interface CriticalProduct {
  id: string;
  name: string;
  stock: number;
  expiry_date: string | null;
}

function describeProduct(product: CriticalProduct): string {
  if (product.stock <= LOW_STOCK_THRESHOLD) {
    return `Le produit ${product.name} (Stock: ${product.stock}) necessite un reassort immediat.`;
  }
  return `Le produit ${product.name} arrive a expiration.`;
}

Deno.serve(async (_req: Request) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("[inventory-alerts] VAPID keys are not configured");
    return new Response(JSON.stringify({ error: "push-not-configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  webpush.setVapidDetails("mailto:admin@citeshop.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const expiryHorizonIso = new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, stock, expiry_date")
    .or(`stock.lte.${LOW_STOCK_THRESHOLD},expiry_date.lte.${expiryHorizonIso}`);

  if (productsError) {
    console.error("[inventory-alerts] failed to query products", productsError);
    return new Response(JSON.stringify({ error: "query-failed" }), { status: 500 });
  }

  const criticalProducts: CriticalProduct[] = (products ?? []).filter(
    (p) => p.stock <= LOW_STOCK_THRESHOLD || (p.expiry_date !== null && p.expiry_date <= expiryHorizonIso),
  );

  if (criticalProducts.length === 0) {
    return new Response(JSON.stringify({ alerted: 0, criticalCount: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: subscriptions, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, profiles!inner(role)")
    .eq("profiles.role", "admin");

  if (subsError) {
    console.error("[inventory-alerts] failed to query admin subscriptions", subsError);
    return new Response(JSON.stringify({ error: "query-failed" }), { status: 500 });
  }

  const title = "Alerte inventaire";
  const body =
    criticalProducts.length === 1
      ? describeProduct(criticalProducts[0])
      : `${criticalProducts.length} produits necessitent votre attention.`;
  const notificationPayload = JSON.stringify({
    title,
    body,
    url: "/?notification=conflicts",
  });

  let sent = 0;
  for (const subscription of subscriptions ?? []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        notificationPayload,
      );
      sent++;
    } catch (error) {
      console.warn("[inventory-alerts] push send failed for", subscription.endpoint, error);
    }
  }

  return new Response(JSON.stringify({ alerted: sent, criticalCount: criticalProducts.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
