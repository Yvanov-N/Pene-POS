import { db } from "@/lib/db";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { voidSale, type VoidSaleResult } from "@/services/refundService";

// The shop phone received the operator's SMS: the Mobile Money sale is real.
export async function confirmMomoSale(saleId: string): Promise<void> {
  const entry = makeOutboxEntry("generic_update", "sales", { id: saleId, momo_verification_status: "confirmed" });
  await commitLocal(db.sales, () => db.sales.update(saleId, { momo_verification_status: "confirmed" }), entry);
  void pushOutbox(entry);
}

// No SMS ever came: the customer didn't actually pay, so the sale is
// cancelled -- through the same void_sale path as "Cancel / Refund" (admin
// check, stock put back atomically server-side, status -> refunded) -- and
// flagged as a rejected Mobile Money payment so history and reports can tell
// it apart from an ordinary refund.
export async function rejectMomoSale(saleId: string, adminId: string): Promise<VoidSaleResult> {
  const result = await voidSale(saleId, adminId);
  if (!result.success) return result;

  const entry = makeOutboxEntry("generic_update", "sales", { id: saleId, momo_verification_status: "rejected" });
  await commitLocal(db.sales, () => db.sales.update(saleId, { momo_verification_status: "rejected" }), entry);
  void pushOutbox(entry);
  return result;
}
