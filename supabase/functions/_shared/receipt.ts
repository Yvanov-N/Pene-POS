// Shared between share-receipt and receipt-og-image -- both need the same
// receipt lookup and the same French formatting conventions, and Supabase's
// per-function deploy bundles anything under _shared/ automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Some share-target apps flatten navigator.share()'s separate title/text/url
// fields into one string before a recipient's link ever reaches this
// function (a documented Android Web Share intent-merging quirk, not
// something the sending client's own code can fully prevent). Extracting
// just the UUID from the raw ?id= value means a mangled query param like
// "8bfa72da-...-14c8646396ae Purchase receipt" still resolves the real
// receipt instead of a false "not found". Kept byte-for-byte identical to
// apps/web/src/pages/ReceiptPage.tsx's own copy of this pattern -- there's no
// shared-package boundary between this Deno edge runtime and the Vite web
// bundle, so the two must be updated together if this ever changes.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractSaleId(raw: string | null): string | null {
  return raw?.match(UUID_PATTERN)?.[0] ?? null;
}

export interface ReceiptItem {
  product_name: string | null;
  quantity: number;
  unit_price: number;
}

export interface ReceiptData {
  id: string;
  created_at: string;
  payment_method: string;
  total_amount: number;
  status: string;
  cashier_name: string | null;
  student_name: string | null;
  items: ReceiptItem[];
}

// A real RPC/network failure (misconfigured grant, outage, transient error)
// and a genuine "no such sale" both used to collapse into the exact same
// `null` here -- a caller had no way to tell "something is broken" from
// "someone guessed a bad UUID", and neither ever got logged anywhere. Now
// distinguished explicitly so both callers can log the real-error case
// (visible in `supabase functions logs`) while still rendering the same
// graceful fallback card either way -- a bot/anonymous visitor shouldn't see
// a raw error regardless of which kind of failure it was.
export type ReceiptLookupResult =
  | { status: "found"; receipt: ReceiptData }
  | { status: "not-found" }
  | { status: "error"; error: unknown };

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Especes",
  momo_mtn: "MTN MoMo",
  momo_orange: "Orange Money",
  student_wallet: "Portefeuille etudiant",
};

export function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method] ?? method;
}

// Plain grouped digits, no currency symbol -- callers append "FCFA"
// themselves (matching the exact "${formattedTotal} FCFA" template this was
// built for; the symbol is baked in if you use style: "currency" instead).
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

export function escapeMarkup(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Reuses the same narrow, anon-granted SECURITY DEFINER RPC (migration 6,
// rebuilt in migration 21) that ReceiptPage.tsx itself falls back to when
// offline -- this function never touches sales/sale_items/products directly,
// so a scraper hitting it can never see more than an anonymous client already
// could (no cashier_id, no student_wallet id).
export async function getReceiptData(saleId: string): Promise<ReceiptLookupResult> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.rpc("get_public_receipt", { p_sale_id: saleId });

  if (error) return { status: "error", error };

  const row = data as unknown as ReceiptData | null;
  if (!row?.id) return { status: "not-found" };
  return { status: "found", receipt: row };
}

// Common messaging/social link-preview crawlers, matched case-insensitively
// against the whole User-Agent string. Slack/Discord/Pinterest added beyond
// the prompt's literal list -- same mechanism, just a more complete rollout
// of "known scraper", not a different feature.
const BOT_PATTERN =
  /whatsapp|facebookexternalhit|twitterbot|telegrambot|applebot|linkedinbot|slackbot|discordbot|skypeuripreview|pinterest/i;

// Missing/unrecognized User-Agent defaults to "human" (redirect), matching
// the prompt's framing: bot status must be proven by a known pattern match,
// not assumed from an absent header.
export function isSocialBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return BOT_PATTERN.test(userAgent);
}
