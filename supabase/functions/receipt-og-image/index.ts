// Dynamic 1200x630 receipt preview image for share-receipt's og:image /
// twitter:image. Returns raw SVG rather than a rasterized PNG -- WhatsApp
// and Telegram fetch and render SVG og:images fine (confirmed in practice);
// Facebook's and Twitter/X's scrapers generally expect a raster image and
// may not render this. Genuine PNG parity would mean a satori + resvg-wasm
// render pipeline (a real font-fetching, WASM-init dependency chain) --
// deliberately not taken on here: this SVG path is explicitly sanctioned by
// the phase spec itself ("or returning a beautifully styled raw SVG...
// supported by WhatsApp/Telegram"), has no cold-start/WASM fragility, and
// covers the two platforms named in the deploy target. Upgrading to PNG
// later is a contained change to this one file.
import { extractSaleId, formatAmount, getReceiptData } from "../_shared/receipt.ts";

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_LISTED_ITEMS = 3;

// Hand-converted from the app's real .dark theme tokens (index.css) --
// Deno has no access to Tailwind/CSS custom properties, so these are the
// closest hex equivalents of --surface/--border/--text/--muted/--green.
const COLORS = {
  background: "#121212",
  surface: "#1c1c1c",
  border: "#2e2e2e",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  green: "#3fbd77",
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function buildSvg(params: {
  totalLabel: string | null;
  items: { name: string; quantity: number }[];
  dateLabel: string | null;
  refunded: boolean;
}): string {
  const { totalLabel, items, dateLabel, refunded } = params;

  const totalBlock = totalLabel
    ? `<text x="120" y="230" font-size="60" font-weight="bold" fill="${COLORS.green}" font-family="Arial, sans-serif">${escapeXml(totalLabel)} FCFA${refunded ? " (Rembourse)" : ""}</text>`
    : `<text x="120" y="220" font-size="40" font-weight="bold" fill="${COLORS.muted}" font-family="Arial, sans-serif">Point de vente hors-ligne</text>`;

  const itemRows = items
    .slice(0, MAX_LISTED_ITEMS)
    .map((item, index) => {
      const y = 380 + index * 56;
      const label = escapeXml(truncate(`${item.quantity}x ${item.name}`, 42));
      return `<text x="120" y="${y}" font-size="28" fill="${COLORS.text}" font-family="Arial, sans-serif">${label}</text>`;
    })
    .join("\n    ");

  const itemsBlock =
    itemRows ||
    `<text x="120" y="380" font-size="26" fill="${COLORS.muted}" font-family="Arial, sans-serif">Detail non disponible</text>`;

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.background}" />

    <text x="60" y="90" font-size="36" font-weight="bold" fill="${COLORS.text}" font-family="Arial, sans-serif">🧾 Cite Shop</text>
    <text x="60" y="128" font-size="20" fill="${COLORS.muted}" font-family="Arial, sans-serif">Recu de caisse${dateLabel ? ` · ${escapeXml(dateLabel)}` : ""}</text>

    <rect x="60" y="170" width="1080" height="410" rx="16" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2" />
    <line x1="90" y1="260" x2="1110" y2="260" stroke="${COLORS.border}" stroke-width="2" stroke-dasharray="8,8" />

    ${totalBlock}
    ${itemsBlock}

    <text x="60" y="600" font-size="18" fill="${COLORS.muted}" font-family="Arial, sans-serif">Point de vente hors-ligne pour campus &amp; ecoles</text>
  </svg>`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const saleId = extractSaleId(url.searchParams.get("id"));

  const result = saleId ? await getReceiptData(saleId) : { status: "not-found" as const };
  if (result.status === "error") {
    console.error("[receipt-og-image] get_public_receipt failed", saleId, result.error);
  }

  const svg =
    result.status === "found"
      ? buildSvg({
          totalLabel: formatAmount(result.receipt.total_amount),
          items: result.receipt.items.map((item) => ({ name: item.product_name ?? "Article", quantity: item.quantity })),
          dateLabel: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
            new Date(result.receipt.created_at),
          ),
          refunded: result.receipt.status === "refunded",
        })
      : buildSvg({ totalLabel: null, items: [], dateLabel: null, refunded: false });

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
