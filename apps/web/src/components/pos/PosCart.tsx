import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCart } from "@/hooks/useCart";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { enqueueMutation } from "@/services/syncService";
import { printService } from "@/services/hardware/printService";
import { PinPadModal } from "./PinPadModal";
import type { PaymentMethod, Profile, Sale, SaleItem } from "@/types/db";

const SETTINGS_ID = "default";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];

type PendingAction = "clear" | "checkout" | null;

function CartLineVisual({ image_url, emoji }: { image_url?: string; emoji?: string }) {
  if (image_url) {
    return <img src={image_url} alt="" className="h-10 w-10 rounded-md object-cover" />;
  }
  return (
    <span className="text-2xl" aria-hidden>
      {emoji || "📦"}
    </span>
  );
}

export function PosCart() {
  const { t } = useTranslation();
  const cart = useCart();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const isEmpty = cart.items.length === 0;

  const completeCheckout = async (profile: Profile) => {
    const saleId = crypto.randomUUID();
    const now = new Date().toISOString();
    let committedSale: Sale | null = null;
    let committedItems: SaleItem[] = [];

    await db.transaction(
      "rw",
      db.sales,
      db.sale_items,
      db.products,
      db.sync_queue,
      db.cart_items,
      async () => {
        const sale: Sale = {
          id: saleId,
          created_at: now,
          cashier_id: profile.id,
          total_amount: cart.totalAmount,
          payment_method: paymentMethod!,
          status: "pending_sync",
        };
        await db.sales.put(sale);

        const saleItems: SaleItem[] = cart.items.map((item) => ({
          id: crypto.randomUUID(),
          sale_id: saleId,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.price,
        }));
        await db.sale_items.bulkPut(saleItems);

        for (const item of cart.items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            await db.products.update(item.product_id, {
              stock: Math.max(0, product.stock - item.quantity),
            });
          }
        }

        await enqueueMutation("SALE", "sales", { sale, items: saleItems });

        await db.cart_items.clear();

        committedSale = sale;
        committedItems = saleItems;
      },
    );

    setPaymentMethod(null);

    // Printing is best-effort -- the sale already succeeded, so a printer
    // being unplugged/unpaired must never surface as a checkout failure.
    if (committedSale) {
      try {
        const settings = await db.local_settings.get(SETTINGS_ID);
        await printService.printReceipt(committedSale, committedItems, settings?.printMode ?? "browser");
      } catch (error) {
        console.warn("[PosCart] receipt print failed", error);
      }
    }
  };

  const handlePinSuccess = (profile: Profile) => {
    if (pendingAction === "clear") {
      cart.clearCart();
    } else if (pendingAction === "checkout") {
      void completeCheckout(profile);
    }
    setPendingAction(null);
  };

  return (
    <div className="pos-cart flex w-80 flex-col border-l border-border">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("pos.cart.title")}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isEmpty ? (
          <p className="text-sm text-muted">{t("pos.cart.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cart.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <CartLineVisual image_url={item.image_url} emoji={item.emoji} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted">{formatCurrency(item.price)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => cart.updateQuantity(item.product_id, -1)}
                    className="h-6 w-6 rounded-md border border-border text-sm text-foreground hover:border-accent"
                  >
                    -
                  </button>
                  <span className="w-5 text-center text-sm text-foreground">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => cart.updateQuantity(item.product_id, 1)}
                    className="h-6 w-6 rounded-md border border-border text-sm text-foreground hover:border-accent"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => cart.removeItem(item.product_id)}
                  className="text-muted hover:text-destructive"
                  aria-label={t("pos.cart.remove")}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border p-4">
        <div className="flex items-center justify-between text-sm font-semibold text-foreground">
          <span>{t("pos.cart.total")}</span>
          <span>{formatCurrency(cart.totalAmount)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => setPaymentMethod(method)}
              className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                paymentMethod === method
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface2 text-muted hover:text-foreground"
              }`}
            >
              {t(`pos.cart.paymentMethod.${method}`)}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={isEmpty}
          onClick={() => setPendingAction("clear")}
          className="rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground disabled:opacity-40"
        >
          {t("pos.cart.clear")}
        </button>
        <button
          type="button"
          disabled={isEmpty || !paymentMethod}
          onClick={() => setPendingAction("checkout")}
          className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-40"
        >
          {t("pos.cart.checkout")}
        </button>
      </div>

      {pendingAction && (
        <PinPadModal
          title={pendingAction === "clear" ? t("pos.pin.clearTitle") : t("pos.pin.checkoutTitle")}
          onSuccess={handlePinSuccess}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
