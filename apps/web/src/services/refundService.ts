import { db } from "@/lib/db";
import { makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { cancelPendingSalePush } from "@/services/sync/drain";

export type VoidSaleFailureReason = "not-authorized" | "not-found" | "already-refunded" | "unknown-error";

export interface VoidSaleResult {
  success: boolean;
  message?: VoidSaleFailureReason;
  // True if the eager push below didn't land immediately (offline, timed
  // out, or a genuine conflict) -- lets the caller show the same
  // offline-fallback toast every other write path shows.
  usedFallback?: boolean;
}

// Voids/refunds a sale: restores each line's stock, credits back a wallet
// payment, and flips the sale to "refunded" -- all via the server-side
// void_sale RPC (migration 00029), NOT three independently-pushed whole-row
// updates the way this function used to work. That old shape read each
// product's stock into a local snapshot, added the refunded quantity, and
// pushed the ENTIRE row back as a last-write-wins UPDATE -- a sale ringing
// up on another terminal between that read and that write was silently
// overwritten, a confirmed root cause of reported stock mismatches. The
// local Dexie writes below still use a local read-then-write snapshot too,
// but that's fine and expected -- it's the same optimistic-then-reconciled
// pattern every write in this app uses (the next pull's sync_seq "only
// accept if newer" check corrects any local drift). What actually matters
// is that the SERVER's canonical value is only ever touched through
// adjust_product_stock's atomic delta (via void_sale), never a whole-row
// overwrite -- that's the real fix.
export async function voidSale(saleId: string, adminId: string): Promise<VoidSaleResult> {
  // Defense in depth: ButtonCustom's requiresAdminPin + PinPadModal already
  // gate the UI entry point to this function, but a "secure" refund path is
  // worth a second, service-level check that the caller is a real admin
  // profile rather than trusting the UI layer alone. void_sale itself
  // re-checks this server-side too (RLS alone doesn't restrict this update
  // to admins -- see that migration's own comment), so a spoofed adminId
  // still can't get past the RPC even if this local check were bypassed.
  const admin = await db.profiles.get(adminId);
  if (!admin || admin.role !== "admin") {
    return { success: false, message: "not-authorized" };
  }

  try {
    const sale = await db.sales.get(saleId);
    if (!sale) return { success: false, message: "not-found" };
    if (sale.status === "refunded") return { success: false, message: "already-refunded" };

    const items = await db.sale_items.where("sale_id").equals(saleId).toArray();
    const entry = makeOutboxEntry("void_sale", "sales", { sale_id: saleId, admin_id: adminId });

    await db.transaction(
      "rw",
      [db.sales, db.sale_items, db.products, db.student_wallets, db.sync_outbox],
      async () => {
        // Cancel any not-yet-pushed original SALE outbox entry for this sale
        // first -- otherwise it could still reach Supabase and re-decrement
        // server-side stock (or re-insert the now-voided sale) after we've
        // already restored everything locally below.
        await cancelPendingSalePush(saleId);

        for (const item of items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            await db.products.update(item.product_id, { stock: product.stock + item.quantity });
          }
        }

        if (sale.payment_method === "student_wallet" && sale.student_id) {
          const wallet = await db.student_wallets.get(sale.student_id);
          if (wallet) {
            await db.student_wallets.update(wallet.id, { balance: wallet.balance + sale.total_amount });
          }
        }

        await db.sales.update(saleId, { status: "refunded" });
        await recordOutbox(entry);
      },
    );

    const outcome = await pushOutbox(entry);
    return { success: true, usedFallback: outcome !== "synced" };
  } catch (error) {
    // Dexie rolls the whole transaction back on any thrown error -- no
    // partial stock/wallet/status writes survive a mid-loop failure.
    console.error("[refundService] voidSale failed", saleId, adminId, error);
    return { success: false, message: "unknown-error" };
  }
}
