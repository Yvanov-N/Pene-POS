import { db } from "@/lib/db";
import { cancelPendingSalePush, enqueueMutation } from "@/services/syncService";

export type VoidSaleFailureReason = "not-authorized" | "not-found" | "already-refunded" | "unknown-error";

export interface VoidSaleResult {
  success: boolean;
  message?: VoidSaleFailureReason;
}

export async function voidSale(saleId: string, adminId: string): Promise<VoidSaleResult> {
  // Defense in depth: ButtonCustom's requiresAdminPin + PinPadModal already
  // gate the UI entry point to this function, but a "secure" refund path is
  // worth a second, service-level check that the caller is a real admin
  // profile rather than trusting the UI layer alone.
  const admin = await db.profiles.get(adminId);
  if (!admin || admin.role !== "admin") {
    return { success: false, message: "not-authorized" };
  }

  try {
    await db.transaction(
      "rw",
      db.sales,
      db.sale_items,
      db.products,
      db.student_wallets,
      db.sync_queue,
      async () => {
        const sale = await db.sales.get(saleId);
        if (!sale) throw new Error("not-found");
        if (sale.status === "refunded") throw new Error("already-refunded");

        const items = await db.sale_items.where("sale_id").equals(saleId).toArray();

        // Cancel any not-yet-pushed original SALE queue entry for this sale
        // first -- otherwise it could still reach Supabase and re-decrement
        // server-side stock (or re-insert the now-voided sale) after we've
        // already restored everything locally below. Same defensive pattern
        // as MoMoVerificationCard's reject flow (Phase 7.2).
        await cancelPendingSalePush(saleId);

        for (const line of items) {
          const product = await db.products.get(line.product_id);
          if (product) {
            const restored = { ...product, stock: product.stock + line.quantity };
            await db.products.put(restored);
            await enqueueMutation("UPDATE", "products", { ...restored });
          }
        }

        if (sale.payment_method === "student_wallet" && sale.student_id) {
          const wallet = await db.student_wallets.get(sale.student_id);
          if (wallet) {
            const nextBalance = wallet.balance + sale.total_amount;
            await db.student_wallets.update(wallet.id, { balance: nextBalance });
            await enqueueMutation("WALLET_RECHARGE", "student_wallets", {
              wallet_id: wallet.id,
              delta: sale.total_amount,
            });
          }
        }

        await db.sales.update(saleId, { status: "refunded" });
        await enqueueMutation("UPDATE", "sales", { id: saleId, status: "refunded" });
      },
    );

    return { success: true };
  } catch (error) {
    if (error instanceof Error && (error.message === "not-found" || error.message === "already-refunded")) {
      return { success: false, message: error.message };
    }
    // Dexie rolls the whole transaction back on any thrown error -- no
    // partial stock/wallet/status writes survive a mid-loop failure.
    console.error("[refundService] voidSale failed", saleId, adminId, error);
    return { success: false, message: "unknown-error" };
  }
}
