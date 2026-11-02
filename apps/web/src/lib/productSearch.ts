import type { Product } from "@/types/db";

// "500", "1 000", "1.000", "500f", "500 FCFA" -> "500" / "1000"; "12,5" or
// "12.50" -> "12.5". A separator followed by exactly 3 digits groups
// thousands; one followed by 1-2 digits is the decimal point. Returns null
// when the term isn't a price (has letters other than a trailing currency).
export function parsePriceTerm(term: string): string | null {
  let compact = term
    .toLowerCase()
    .trim()
    .replace(/(fcfa|xaf|f)$/, "")
    .replace(/[\s\u00a0\u202f]/g, "");
  const decimal = compact.match(/^(.*)[.,](\d{1,2})$/);
  let fraction = "";
  if (decimal) {
    compact = decimal[1];
    fraction = decimal[2].replace(/0+$/, "");
  }
  compact = compact.replace(/[.,](?=\d{3}(\D|$))/g, "");
  if (!/^\d+$/.test(compact)) return null;
  return fraction ? `${compact}.${fraction}` : compact;
}

// POS search: name or barcode substring, or -- when the term reads as a
// number -- any product whose price contains those digits (so "500" finds
// 500 and 1500; exact matches are ranked first by the caller via
// isExactPriceMatch).
export function matchesProductSearch(product: Pick<Product, "name" | "barcode" | "price">, rawTerm: string): boolean {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return true;
  if (product.name.toLowerCase().includes(term)) return true;
  if ((product.barcode ?? "").toLowerCase().includes(term)) return true;
  const priceDigits = parsePriceTerm(term);
  return priceDigits !== null && String(product.price).includes(priceDigits);
}

export function isExactPriceMatch(product: Pick<Product, "price">, rawTerm: string): boolean {
  const priceDigits = parsePriceTerm(rawTerm.trim());
  return priceDigits !== null && String(product.price) === priceDigits;
}
