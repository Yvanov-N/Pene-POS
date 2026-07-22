import { db } from "@/lib/db";
import { cancelPendingSalePush, enqueueMutation } from "@/services/syncService";
import { submitGenericMutationNetworkFirst, submitWalletAdjustmentNetworkFirst, type WriteMode } from "@/services/repository";
import type { Product } from "@/types/db";

export type VoidSaleFailureReason = "not-authorized" | "not-found" | "already-refunded" | "unknown-error";

export interface VoidSaleResult {
  success: boolean;
  message?: VoidSaleFailureReason;
  // True if any of the (up to 3) server writes below fell back to the local
  // queue instead of landing directly -- lets the caller show the same
  // offline-fallback toast every other write path shows.
  usedFallback?: boolean;
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
    const sale = await db.sales.get(saleId);
    if (!sale) return { success: false, message: "not-found" };
    if (sale.status === "refunded") return { success: false, message: "already-refunded" };

    const items = await db.sale_items.where("sale_id").equals(saleId).toArray();

    const restoredProducts: Product[] = [];
    for (const line of items) {
      const product = await db.products.get(line.product_id);
      if (product) restoredProducts.push({ ...product, stock: product.stock + line.quantity });
    }

    const wallet =
      sale.payment_method === "student_wallet" && sale.student_id
        ? await db.student_wallets.get(sale.student_id)
        : undefined;
    const nextWalletBalance = wallet ? wallet.balance + sale.total_amount : null;

    // Up to 3 independent server writes (N product restocks, a wallet
    // credit-back, the sale's status flip) -- run them concurrently so
    // worst-case added latency stays ~2.5s total, not stacked per-write.
    const [productModes, walletMode, saleStatusMode] = await Promise.all([
      Promise.all(restoredProducts.map((p) => submitGenericMutationNetworkFirst("UPDATE", "products", { ...p }))),
      wallet
        ? submitWalletAdjustmentNetworkFirst({ wallet_id: wallet.id, delta: sale.total_amount })
        : Promise.resolve<WriteMode>("cloud"),
      submitGenericMutationNetworkFirst("UPDATE", "sales", { id: saleId, status: "refunded" }),
    ]);

    let usedFallback = false;

    await db.transaction(
      "rw",
      db.sales,
      db.sale_items,
      db.products,
      db.student_wallets,
      db.sync_queue,
      async () => {
        // Cancel any not-yet-pushed original SALE queue entry for this sale
        // first -- otherwise it could still reach Supabase and re-decrement
        // server-side stock (or re-insert the now-voided sale) after we've
        // already restored everything locally below. Same defensive pattern
        // as MoMoVerificationCard's reject flow (Phase 7.2).
        await cancelPendingSalePush(saleId);

        for (const [index, restored] of restoredProducts.entries()) {
          await db.products.put(restored);
          if (productModes[index] === "local") {
            usedFallback = true;
            await enqueueMutation("UPDATE", "products", { ...restored });
          }
        }

        if (wallet && nextWalletBalance !== null) {
          await db.student_wallets.update(wallet.id, { balance: nextWalletBalance });
          if (walletMode === "local") {
            usedFallback = true;
            await enqueueMutation("WALLET_RECHARGE", "student_wallets", {
              wallet_id: wallet.id,
              delta: sale.total_amount,
            });
          }
        }

        await db.sales.update(saleId, { status: "refunded" });
        if (saleStatusMode === "local") {
          usedFallback = true;
          await enqueueMutation("UPDATE", "sales", { id: saleId, status: "refunded" });
        }
      },
    );

    return { success: true, usedFallback };
  } catch (error) {
    // Dexie rolls the whole transaction back on any thrown error -- no
    // partial stock/wallet/status writes survive a mid-loop failure.
    console.error("[refundService] voidSale failed", saleId, adminId, error);
    return { success: false, message: "unknown-error" };
  }
}
