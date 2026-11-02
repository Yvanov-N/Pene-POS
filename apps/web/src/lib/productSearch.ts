import type { Product } from "@/types/db";

// "500", "1 000", "1.000", "500f", "500 FCFA" -> "500" / "1000". Returns null
// when the term isn't a price (has letters other than a trailing currency).
export function parsePriceTerm(term: string): string | null {
  const compact = term
    .toLowerCase()
    .replace(/(fcfa|xaf|f)$/, "")
    .replace(/[\s.,  ]/g, "");
  return /^\d+$/.test(compact) ? compact : null;
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
