import type { Sale } from "@/types/db";

export interface SaleSearchContext {
  cashierNames: Map<string, string>;
  studentNames: Map<string, string>;
  // Ids of sales with at least one line whose product name matches the term.
  saleIdsWithMatchingProduct: Set<string>;
}

// Local (offline) counterpart of the server search in SalesHistoryPage:
// sale id, cashier, device, student or any product on the sale. `term` is
// expected already trimmed and lower-cased.
export function matchesSaleSearch(sale: Sale, term: string, context: SaleSearchContext): boolean {
  if (!term) return true;
  return (
    sale.id.toLowerCase().includes(term) ||
    (context.cashierNames.get(sale.cashier_id) ?? "").toLowerCase().includes(term) ||
    (sale.device_label ?? "").toLowerCase().includes(term) ||
    (context.studentNames.get(sale.student_id ?? "") ?? "").toLowerCase().includes(term) ||
    context.saleIdsWithMatchingProduct.has(sale.id)
  );
}
