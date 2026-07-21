// Bot vs human link-preview interceptor for /receipt/:saleId (Phase 9.1).
// Deployed with verify_jwt = false (see supabase/config.toml) -- both real
// visitors clicking a shared link and social-platform scrapers fetch this
// with no Supabase auth header at all.
import {
  escapeMarkup,
  extractSaleId,
  formatAmount,
  formatDate,
  getReceiptData,
  isSocialBot,
  paymentLabel,
} from "../_shared/receipt.ts";

// Must point at the deployed PWA's real origin in production -- set via
// `supabase secrets set PWA_URL=https://your-domain` before deploying.
// Defaults to the local Vite dev server so `supabase functions serve` works
// against `pnpm dev` out of the box.
const PWA_URL = Deno.env.get("PWA_URL") ?? "http://localhost:5173";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const MAX_LISTED_ITEMS = 3;

function buildItemNamesList(items: { product_name: string | null; quantity: number }[]): string {
  const names = items.map((item) => item.product_name ?? "Article");
  if (names.length <= MAX_LISTED_ITEMS) return names.join(", ");
  const shown = names.slice(0, MAX_LISTED_ITEMS).join(", ");
  return `${shown} et ${names.length - MAX_LISTED_ITEMS} autre(s)`;
}

function buildHtml(params: { pageTitle: string; ogTitle: string; ogDescription: string; receiptUrl: string; imageUrl: string }): string {
  const { pageTitle, ogTitle, ogDescription, receiptUrl, imageUrl } = params;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${escapeMarkup(pageTitle)}</title>
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Cite Shop Point of Sale" />
  <meta property="og:title" content="${escapeMarkup(ogTitle)}" />
  <meta property="og:description" content="${escapeMarkup(ogDescription)}" />
  <meta property="og:url" content="${escapeMarkup(receiptUrl)}" />
  <meta property="og:image" content="${escapeMarkup(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeMarkup(ogTitle)}" />
  <meta name="twitter:description" content="${escapeMarkup(ogDescription)}" />
  <meta name="twitter:image" content="${escapeMarkup(imageUrl)}" />
  <meta http-equiv="refresh" content="0; url=${escapeMarkup(receiptUrl)}" />
</head>
<body>
  <p>Redirection vers votre recu Cite Shop...</p>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const saleId = extractSaleId(url.searchParams.get("id"));
  const userAgent = req.headers.get("user-agent");

  if (!saleId) {
    return Response.redirect(PWA_URL, 302);
  }

  const receiptUrl = `${PWA_URL}/receipt/${saleId}`;

  // Humans go straight to the real app -- no DB round trip needed here,
  // ReceiptPage.tsx already handles its own not-found state client-side.
  if (!isSocialBot(userAgent)) {
    return Response.redirect(receiptUrl, 302);
  }

  const fallbackImageUrl = `${SUPABASE_URL}/functions/v1/receipt-og-image`;
  const receipt = await getReceiptData(saleId);

  if (!receipt) {
    // Bad/stale/deleted sale id -- a generic branded card still beats a
    // broken preview or a raw error page inside the chat app.
    const html = buildHtml({
      pageTitle: "Recu Cite Shop",
      ogTitle: "Recu Cite Shop",
      ogDescription: "Ce recu n'est plus disponible.",
      receiptUrl,
      imageUrl: fallbackImageUrl,
    });
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const formattedTotal = formatAmount(receipt.total_amount);
  const formattedDate = formatDate(receipt.created_at);
  const totalItems = receipt.items.reduce((sum, item) => sum + item.quantity, 0);
  const itemNamesList = buildItemNamesList(receipt.items);

  const ogTitle = `Recu Cite Shop #${receipt.id.slice(0, 6)} — ${formattedTotal} FCFA`;
  const ogDescription = `Achat du ${formattedDate}. Articles : ${itemNamesList} (${totalItems} articles). Paye via ${paymentLabel(receipt.payment_method)}.`;
  const imageUrl = `${SUPABASE_URL}/functions/v1/receipt-og-image?id=${encodeURIComponent(saleId)}`;

  const html = buildHtml({
    pageTitle: `Recu Cite Shop - ${formattedTotal} FCFA`,
    ogTitle,
    ogDescription,
    receiptUrl,
    imageUrl,
  });

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
});
