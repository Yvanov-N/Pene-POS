import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Smartphone, GraduationCap, X, Trash2, ChevronUp, ChevronDown, type LucideIcon } from "lucide-react";
import { usePosCheckout, PAYMENT_METHODS } from "@/hooks/usePosCheckout";
import { formatCurrency } from "@/lib/currency";
import { PinPadModal } from "./PinPadModal";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { PaymentMethod } from "@/types/db";

const PAYMENT_ICON: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  momo_mtn: Smartphone,
  momo_orange: Smartphone,
  student_wallet: GraduationCap,
};

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

// Mobile chrome only (below md) -- PosLayout mounts this or PosCart based on
// viewport, never both, so this owns its own usePosCheckout() instance
// without any risk of desyncing from another one (see usePosCheckout.ts).
//
// Real drag-to-expand physics (Vaul/Radix-style) would need a gesture
// library this repo doesn't have anywhere else -- every other overlay in the
// app (ProductFormDrawer, PinPadModal, the toast stack) is a hand-rolled
// Tailwind transition, not a drag gesture. Tap-to-toggle is the equivalent
// the prompt itself offers ("or clicks a 'Voir le panier' toggle") and
// matches this codebase's existing overlay pattern, so that's what this
// implements instead of pulling in a new dependency for one screen.
export function MobileCartSheet() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const {
    cart,
    isEmpty,
    paymentMethod,
    setPaymentMethod,
    isWalletPayment,
    walletInsufficient,
    canCheckout,
    studentSearchTerm,
    setStudentSearchTerm,
    studentResults,
    selectedStudent,
    selectStudent,
    clearStudent,
    pendingAction,
    requestCheckout,
    cancelPendingAction,
    handleCheckoutPinSuccess,
  } = usePosCheckout();

  return (
    <div className="mobile-cart-sheet fixed inset-x-0 bottom-0 z-30 flex flex-col md:hidden">
      <div
        className={`overflow-hidden rounded-t-2xl border border-b-0 border-border bg-surface shadow-2xl transition-[max-height] duration-300 ease-out ${
          expanded ? "max-h-[65vh]" : "max-h-0"
        }`}
      >
        <div className="max-h-[65vh] overflow-y-auto p-4">
          {isEmpty ? (
            <p className="py-6 text-center text-sm text-muted">{t("pos.cart.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {cart.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3">
                  <CartLineVisual image_url={item.image_url} emoji={item.emoji} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted">{formatCurrency(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => cart.updateQuantity(item.product_id, -1)}
                      className="h-8 w-8 rounded-md border border-border text-base text-foreground hover:border-accent"
                    >
                      -
                    </button>
                    <span className="w-5 text-center text-sm text-foreground">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => cart.updateQuantity(item.product_id, 1)}
                      className="h-8 w-8 rounded-md border border-border text-base text-foreground hover:border-accent"
                    >
                      +
                    </button>
                  </div>
                  {/* Instant, no PIN -- Page 2's frictionless-POS requirement. */}
                  <button
                    type="button"
                    onClick={() => cart.removeItem(item.product_id)}
                    aria-label={t("pos.cart.remove")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground hover:opacity-90"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {paymentMethod && (
            <div className="mt-4 flex flex-col gap-1 border-t border-border pt-4">
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
                    onClick={clearStudent}
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
        </div>
      </div>

      <div
        className="border-t border-border bg-surface px-3 pt-1.5 shadow-[0_-4px_12px_rgba(0,0,0,0.12)]"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={expanded ? t("pos.cart.hideCart") : t("pos.cart.viewCart")}
          className="mx-auto flex w-full flex-col items-center gap-1 py-1"
        >
          <span className="h-1 w-10 rounded-full bg-border" aria-hidden />
          <span className="flex items-center gap-2 text-xs font-medium text-foreground">
            <span className="badge-blue">{t("pos.cart.itemsBadge", { count: cart.totalItems })}</span>
            <span className="font-semibold">{formatCurrency(cart.totalAmount)}</span>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-muted" aria-hidden />
            )}
          </span>
        </button>

        <div className="mb-2 grid grid-cols-4 gap-1.5">
          {PAYMENT_METHODS.map((method) => {
            const Icon = PAYMENT_ICON[method];
            return (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] font-medium leading-tight transition-colors ${
                  paymentMethod === method
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-surface2 text-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="w-full truncate text-center">{t(`pos.cart.paymentMethod.${method}`)}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pb-1">
          {/* Instant, no PIN -- same frictionless requirement. */}
          <button
            type="button"
            onClick={() => cart.clearCart()}
            disabled={isEmpty}
            aria-label={t("pos.cart.clear")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface2 text-destructive disabled:opacity-40"
          >
            <Trash2 className="h-5 w-5" aria-hidden />
          </button>
          <ButtonCustom
            variant="success"
            size="lg"
            className="flex-1"
            disabled={!canCheckout}
            onClick={requestCheckout}
          >
            {t("pos.cart.checkout")}
          </ButtonCustom>
        </div>
      </div>

      {pendingAction === "checkout" && (
        <PinPadModal
          title={t("pos.pin.checkoutTitle")}
          onSuccess={handleCheckoutPinSuccess}
          onClose={cancelPendingAction}
        />
      )}
    </div>
  );
}
