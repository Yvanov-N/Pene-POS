import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { useCart } from "@/hooks/useCart";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { enqueueMutation } from "@/services/syncService";
import { printService } from "@/services/hardware/printService";
import { PinPadModal } from "./PinPadModal";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { PaymentMethod, Profile, Sale, SaleItem, StudentWallet } from "@/types/db";

const SETTINGS_ID = "default";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];

// "clear" no longer needs to live here -- ButtonCustom's requiresAdminPin
// now owns that gate itself. Only checkout still uses this shared
// pending-action/PinPadModal pattern (its any-role gate predates this phase
// and isn't being changed).
type PendingAction = "checkout" | null;

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
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentWallet | null>(null);

  const isEmpty = cart.items.length === 0;
  const isWalletPayment = paymentMethod === "student_wallet";
  const walletInsufficient = isWalletPayment && selectedStudent !== null && selectedStudent.balance < cart.totalAmount;
  const canCheckout =
    !isEmpty && !!paymentMethod && (!isWalletPayment || (selectedStudent !== null && !walletInsufficient));

  // Deliberately not wired to useBarcodeScanner/the shared pos:barcode-scan
  // event the way StudentWalletRechargeCard's search is: that page has no
  // product scanning happening on it at all, so any scan is unambiguously a
  // student badge. Here, on the same screen as BarcodeInput, a scan is
  // *primarily* meant to add a product to the cart -- also feeding it into
  // this search would make every product scan noisily (and wrongly) filter
  // the student picker too. Plain typed search only.
  const studentResults = useLiveQuery(async () => {
    const term = studentSearchTerm.trim().toLowerCase();
    if (!term) return [];
    const all = await db.student_wallets.toArray();
    return all
      .filter((w) => w.student_name.toLowerCase().includes(term) || w.badge_code.toLowerCase().includes(term))
      .slice(0, 6);
  }, [studentSearchTerm]);

  const selectStudent = (wallet: StudentWallet) => {
    setSelectedStudent(wallet);
    setStudentSearchTerm("");
  };

  const completeCheckout = async (profile: Profile) => {
    const saleId = crypto.randomUUID();
    const now = new Date().toISOString();
    let committedSale: Sale | null = null;
    let committedItems: SaleItem[] = [];

    await db.transaction(
      "rw",
      // Array form -- Dexie's variadic-table-argument overloads cap out
      // below the 6 tables this transaction now touches (adding
      // student_wallets pushed it over that limit).
      [db.sales, db.sale_items, db.products, db.student_wallets, db.sync_queue, db.cart_items],
      async () => {
        const sale: Sale = {
          id: saleId,
          created_at: now,
          cashier_id: profile.id,
          total_amount: cart.totalAmount,
          payment_method: paymentMethod!,
          student_id: selectedStudent?.id,
          status: "pending_sync",
          // Only Mobile Money sales need a shop-phone SMS checked before
          // they're considered settled -- cash and student_wallet sales
          // never enter this workflow at all.
          momo_verification_status:
            paymentMethod === "momo_mtn" || paymentMethod === "momo_orange" ? "pending" : undefined,
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

        // Real balance deduction, reusing the exact same adjust_wallet_balance
        // RPC / WALLET_RECHARGE mutation the recharge flow already uses --
        // just a negative delta. The server's non-negative balance CHECK
        // constraint is the real backstop against a race between two devices
        // spending the same wallet before either has synced; this local
        // sufficiency check (canCheckout above) just avoids hitting that in
        // the overwhelmingly common single-device case.
        if (isWalletPayment && selectedStudent) {
          const nextBalance = selectedStudent.balance - cart.totalAmount;
          await db.student_wallets.update(selectedStudent.id, { balance: nextBalance });
          await enqueueMutation("WALLET_RECHARGE", "student_wallets", {
            wallet_id: selectedStudent.id,
            delta: -cart.totalAmount,
          });
        }

        await db.cart_items.clear();

        committedSale = sale;
        committedItems = saleItems;
      },
    );

    setPaymentMethod(null);
    setSelectedStudent(null);

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

  const handleCheckoutPinSuccess = (profile: Profile) => {
    void completeCheckout(profile);
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
                <ButtonCustom
                  variant="danger"
                  size="icon"
                  requiresAdminPin
                  aria-label={t("pos.cart.remove")}
                  onClick={() => cart.removeItem(item.product_id)}
                >
                  ✕
                </ButtonCustom>
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

        {paymentMethod && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">
              {isWalletPayment ? t("pos.cart.studentRequired") : t("pos.cart.studentOptional")}
            </span>
            {selectedStudent ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{selectedStudent.student_name}</p>
                  {isWalletPayment && (
                    <p className={`text-xs ${walletInsufficient ? "text-destructive" : "text-muted"}`}>
                      {t("pos.cart.walletBalance", { balance: formatCurrency(selectedStudent.balance) })}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  className="shrink-0 text-xs text-muted hover:text-foreground"
                >
                  {t("pos.cart.removeStudent")}
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={studentSearchTerm}
                  onChange={(e) => setStudentSearchTerm(e.target.value)}
                  placeholder={t("pos.cart.studentSearchPlaceholder")}
                  className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
                />
                {studentSearchTerm.trim() && (
                  <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
                    {studentResults === undefined || studentResults.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-muted">{t("pos.cart.studentNoResults")}</li>
                    ) : (
                      studentResults.map((wallet) => (
                        <li key={wallet.id}>
                          <button
                            type="button"
                            onClick={() => selectStudent(wallet)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface2"
                          >
                            <span className="text-foreground">{wallet.student_name}</span>
                            <span className="text-muted">{wallet.badge_code}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            )}
            {walletInsufficient && <p className="text-xs text-destructive">{t("pos.cart.walletInsufficient")}</p>}
          </div>
        )}

        <ButtonCustom
          variant="danger"
          disabled={isEmpty}
          requiresAdminPin
          pinModalTitle={t("pos.pin.clearTitle")}
          onClick={() => cart.clearCart()}
        >
          {t("pos.cart.clear")}
        </ButtonCustom>
        <ButtonCustom variant="success" disabled={!canCheckout} onClick={() => setPendingAction("checkout")}>
          {t("pos.cart.checkout")}
        </ButtonCustom>
      </div>

      {pendingAction === "checkout" && (
        <PinPadModal
          title={t("pos.pin.checkoutTitle")}
          onSuccess={handleCheckoutPinSuccess}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
