// Invoked hourly by pg_cron + pg_net (migration 00003) -- also safe to call
// directly (idempotent: does nothing if nothing is critical). Despite the
// function's name (kept as-is so the existing cron job URL/schedule needs
// no migration change), this now covers all three of Phase 15's "operational
// alert" categories that are naturally checked on a schedule rather than
// fired by a single user action: low stock, upcoming expiry, and critical
// student debt. Shop open/close is the fourth category, but that one's
// event-driven (a DB webhook off shop_status), not cron -- see
// notify-shop-status.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { configureVapid, sendToSubscriptions, type PushNotificationPayload } from "../_shared/webpush.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LOW_STOCK_THRESHOLD = 3;
const EXPIRY_WARNING_DAYS = 7;
// Matches CriticalDebtWidget.tsx's own threshold -- the dashboard widget and
// this push alert must agree on what "critical" means, or an admin gets a
// push for something the dashboard doesn't flag (or vice versa).
const CRITICAL_DEBT_THRESHOLD = -5000;

interface CriticalProduct {
  id: string;
  name: string;
  stock: number;
  expiry_date: string | null;
}

interface Debtor {
  id: string;
  student_name: string;
  balance: number;
}

function describeProduct(product: CriticalProduct): string {
  if (product.stock <= LOW_STOCK_THRESHOLD) {
    return `Le produit ${product.name} (Stock: ${product.stock}) necessite un reassort immediat.`;
  }
  return `Le produit ${product.name} arrive a expiration.`;
}

Deno.serve(async (_req: Request) => {
  if (!configureVapid()) {
    console.error("[inventory-alerts] VAPID keys are not configured");
    return new Response(JSON.stringify({ error: "push-not-configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const expiryHorizonIso = new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: products, error: productsError }, { data: debtors, error: debtorsError }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, stock, expiry_date")
      .or(`stock.lte.${LOW_STOCK_THRESHOLD},expiry_date.lte.${expiryHorizonIso}`),
    supabase.from("student_wallets").select("id, student_name, balance").lte("balance", CRITICAL_DEBT_THRESHOLD),
  ]);

  if (productsError) {
    console.error("[inventory-alerts] failed to query products", productsError);
    return new Response(JSON.stringify({ error: "query-failed" }), { status: 500 });
  }
  if (debtorsError) {
    console.error("[inventory-alerts] failed to query student debt", debtorsError);
    return new Response(JSON.stringify({ error: "query-failed" }), { status: 500 });
  }

  const criticalProducts: CriticalProduct[] = (products ?? []).filter(
    (p) => p.stock <= LOW_STOCK_THRESHOLD || (p.expiry_date !== null && p.expiry_date <= expiryHorizonIso),
  );
  const criticalDebtors: Debtor[] = debtors ?? [];

  if (criticalProducts.length === 0 && criticalDebtors.length === 0) {
    return new Response(JSON.stringify({ alerted: 0, criticalProductCount: 0, criticalDebtorCount: 0 }), {
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

  // Two independently-tagged notifications, not one combined blob: an
  // inventory alert and a debt alert are unrelated concerns an admin acts on
  // differently, and each should collapse against its OWN previous hourly
  // run (tag) rather than against the other category's.
  const notifications: PushNotificationPayload[] = [];

  if (criticalProducts.length > 0) {
    notifications.push({
      title: "Alerte inventaire",
      body:
        criticalProducts.length === 1
          ? describeProduct(criticalProducts[0])
          : `${criticalProducts.length} produits necessitent votre attention.`,
      url: "/admin/restocking",
      tag: "inventory-alert",
    });
  }

  if (criticalDebtors.length > 0) {
    notifications.push({
      title: "Alerte dettes etudiantes",
      body:
        criticalDebtors.length === 1
          ? `${criticalDebtors[0].student_name} doit ${Math.abs(criticalDebtors[0].balance).toLocaleString()} FCFA.`
          : `${criticalDebtors.length} etudiants ont une dette critique.`,
      url: "/admin/dashboard",
      tag: "debt-alert",
    });
  }

  let sent = 0;
  let pruned = 0;
  for (const payload of notifications) {
    const result = await sendToSubscriptions(supabase, subscriptions ?? [], payload);
    sent += result.sent;
    pruned += result.pruned;
  }

  return new Response(
    JSON.stringify({ alerted: sent, pruned, criticalProductCount: criticalProducts.length, criticalDebtorCount: criticalDebtors.length }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
