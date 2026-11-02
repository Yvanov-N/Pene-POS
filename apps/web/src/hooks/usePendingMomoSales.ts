import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Sale } from "@/types/db";

// Mobile Money sales still waiting for an admin to check the shop phone's SMS
// (momo_verification_status "pending"), newest first. Shared by the
// verification card (Students page) and the POS reminder bubble, so both
// always agree on what's outstanding.
export function usePendingMomoSales(): Sale[] | undefined {
  return useLiveQuery(
    () =>
      db.sales
        .toArray()
        .then((rows) =>
          rows
            .filter(
              (sale) =>
                (sale.payment_method === "momo_mtn" || sale.payment_method === "momo_orange") &&
                sale.momo_verification_status === "pending" &&
                // Already cancelled from the sales history: nothing left to verify.
                sale.status !== "refunded",
            )
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        ),
    [],
  );
}
