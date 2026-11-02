import type { StockPurchase, Supplier, SupplierPriceHistory, SupplierProduct } from "@/types/db";

// Pure helpers behind the restocking screens (offers comparison, history,
// supplier ranking) -- no Dexie access here so they're unit-testable.

export interface ProductSupplierOffer {
  supplier: Supplier;
  // The supplier's current price for this product (supplier_products), if any.
  offerPrice?: number;
  offerId?: string;
  lastPaid?: number;
  lastPurchaseAt?: string;
  purchaseCount: number;
  // offerPrice, else lastPaid -- what the comparison ranks on.
  effectivePrice?: number;
  isBest: boolean;
}

function byNewest(a: StockPurchase, b: StockPurchase): number {
  return b.created_at.localeCompare(a.created_at);
}

// Every supplier that either quotes or has sold this product, cheapest first.
// Ties for the lowest price are all flagged best.
export function buildProductOffers(
  productId: string,
  suppliers: Supplier[],
  offers: SupplierProduct[],
  purchases: StockPurchase[],
): ProductSupplierOffer[] {
  const productPurchases = purchases.filter((p) => p.product_id === productId).sort(byNewest);
  const productOffers = offers.filter((o) => o.product_id === productId);

  const rows: ProductSupplierOffer[] = [];
  for (const supplier of suppliers) {
    const offer = productOffers.find((o) => o.supplier_id === supplier.id);
    const supplierPurchases = productPurchases.filter((p) => p.supplier_id === supplier.id);
    if (!offer && supplierPurchases.length === 0) continue;
    const last = supplierPurchases[0];
    rows.push({
      supplier,
      offerPrice: offer?.price,
      offerId: offer?.id,
      lastPaid: last?.unit_cost,
      lastPurchaseAt: last?.created_at,
      purchaseCount: supplierPurchases.length,
      effectivePrice: offer?.price ?? last?.unit_cost,
      isBest: false,
    });
  }

  const priced = rows.filter((r) => r.effectivePrice !== undefined);
  const best = priced.length > 0 ? Math.min(...priced.map((r) => r.effectivePrice!)) : undefined;
  for (const row of rows) row.isBest = best !== undefined && row.effectivePrice === best;

  return rows.sort(
    (a, b) =>
      (a.effectivePrice ?? Number.POSITIVE_INFINITY) - (b.effectivePrice ?? Number.POSITIVE_INFINITY) ||
      a.supplier.name.localeCompare(b.supplier.name),
  );
}

export interface PurchaseSummary {
  count: number;
  totalQuantity: number;
  totalSpent: number;
  lastCost?: number;
  minCost?: number;
  maxCost?: number;
  // Quantity-weighted.
  averageCost?: number;
}

export function summarizePurchases(purchases: StockPurchase[]): PurchaseSummary {
  if (purchases.length === 0) return { count: 0, totalQuantity: 0, totalSpent: 0 };
  const sorted = [...purchases].sort(byNewest);
  const totalQuantity = purchases.reduce((sum, p) => sum + p.quantity, 0);
  const totalSpent = purchases.reduce((sum, p) => sum + p.quantity * p.unit_cost, 0);
  const costs = purchases.map((p) => p.unit_cost);
  return {
    count: purchases.length,
    totalQuantity,
    totalSpent,
    lastCost: sorted[0].unit_cost,
    minCost: Math.min(...costs),
    maxCost: Math.max(...costs),
    averageCost: totalQuantity > 0 ? totalSpent / totalQuantity : undefined,
  };
}

// For each purchase: % change of its unit cost vs the previous purchase of
// the same product (any supplier). Absent for a product's first purchase.
export function priceChangeByPurchase(purchases: StockPurchase[]): Map<string, number> {
  const changes = new Map<string, number>();
  const lastByProduct = new Map<string, number>();
  const chronological = [...purchases].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const purchase of chronological) {
    const previous = lastByProduct.get(purchase.product_id);
    if (previous !== undefined && previous > 0) {
      changes.set(purchase.id, ((purchase.unit_cost - previous) / previous) * 100);
    }
    lastByProduct.set(purchase.product_id, purchase.unit_cost);
  }
  return changes;
}

export interface PriceSeries {
  // One point per price entry; keys other than `date` are supplier ids.
  points: Array<{ date: string } & Record<string, number | string>>;
  supplierIds: string[];
}

// Chart data for one product's supplier prices over time (price history:
// manual updates and restocks), one line per supplier.
export function buildPriceSeries(productId: string, history: SupplierPriceHistory[]): PriceSeries {
  const chronological = history
    .filter((h) => h.product_id === productId)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const supplierIds = [...new Set(chronological.map((h) => h.supplier_id))];
  const points = chronological.map((h) => ({ date: h.recorded_at, [h.supplier_id]: h.price }));
  return { points, supplierIds };
}

export interface PricePoint {
  entry: SupplierPriceHistory;
  // % vs the previous (older) point of the same supplier+product.
  changePct?: number;
}

// A supplier's prices for one product, newest first, each with its change
// vs the one before it.
export function supplierPriceTimeline(
  history: SupplierPriceHistory[],
  supplierId: string,
  productId: string,
): PricePoint[] {
  const chronological = history
    .filter((h) => h.supplier_id === supplierId && h.product_id === productId)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const points = chronological.map((entry, index) => {
    const previous = chronological[index - 1];
    return {
      entry,
      changePct: previous && previous.price > 0 ? ((entry.price - previous.price) / previous.price) * 100 : undefined,
    };
  });
  return points.reverse();
}

export interface SupplierSummary {
  purchaseCount: number;
  totalSpent: number;
  productCount: number;
  // Number of products for which this supplier currently has the best price.
  cheapestOn: number;
  lastPurchaseAt?: string;
}

export function summarizeSuppliers(
  suppliers: Supplier[],
  offers: SupplierProduct[],
  purchases: StockPurchase[],
): Map<string, SupplierSummary> {
  const summaries = new Map<string, SupplierSummary>();
  for (const supplier of suppliers) {
    const own = purchases.filter((p) => p.supplier_id === supplier.id);
    const productIds = new Set([
      ...own.map((p) => p.product_id),
      ...offers.filter((o) => o.supplier_id === supplier.id).map((o) => o.product_id),
    ]);
    summaries.set(supplier.id, {
      purchaseCount: own.length,
      totalSpent: own.reduce((sum, p) => sum + p.quantity * p.unit_cost, 0),
      productCount: productIds.size,
      cheapestOn: 0,
      lastPurchaseAt: own.sort(byNewest)[0]?.created_at,
    });
  }

  const allProductIds = new Set([...offers.map((o) => o.product_id), ...purchases.map((p) => p.product_id)]);
  for (const productId of allProductIds) {
    const ranked = buildProductOffers(productId, suppliers, offers, purchases);
    // A lone supplier isn't "the cheapest" of anything -- nothing to compare.
    if (ranked.length < 2) continue;
    for (const row of ranked) {
      if (row.isBest) summaries.get(row.supplier.id)!.cheapestOn += 1;
    }
  }
  return summaries;
}
