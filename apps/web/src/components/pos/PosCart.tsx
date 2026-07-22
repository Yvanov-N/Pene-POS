import { useTranslation } from "react-i18next";
import { usePosCheckout, PAYMENT_METHODS } from "@/hooks/usePosCheckout";
import { formatCurrency } from "@/lib/currency";
import { PinPadModal } from "./PinPadModal";
import { ReceiptModal } from "./ReceiptModal";
import { ButtonCustom } from "@/components/ui/button-custom";
import { CartLineItem } from "./CartLineItem";

// Desktop/tablet-landscape chrome only (md and up) -- PosLayout mounts this
// or MobileCartSheet based on viewport, never both, so this owns its own
// usePosCheckout() instance without any risk of desyncing from another one.
export function PosCart() {
  const { t } = useTranslation();
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
    lastReceipt,
    dismissReceipt,
    printReceiptNow,
  } = usePosCheckout();

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
              <CartLineItem
                key={item.id}
                item={item}
                size="compact"
                onQuantityChange={cart.updateQuantity}
                onRemove={cart.removeItem}
              />
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
              className={`min-w-0 truncate rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
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
            {walletInsufficient && selectedStudent && (
              <p className="text-xs text-destructive">
                {t("pos.cart.walletInsufficient", {
                  resultingBalance: formatCurrency(selectedStudent.balance - cart.totalAmount),
                })}
              </p>
            )}
          </div>
        )}

        {/* Instant, no PIN -- same frictionless requirement as removing a
            single item above. */}
        <ButtonCustom variant="danger" disabled={isEmpty} onClick={() => cart.clearCart()}>
          {t("pos.cart.clear")}
        </ButtonCustom>
        <ButtonCustom variant="success" disabled={!canCheckout} onClick={requestCheckout}>
          {t("pos.cart.checkout")}
        </ButtonCustom>
      </div>

      {pendingAction === "checkout" && (
        <PinPadModal
          title={t("pos.pin.checkoutTitle")}
          onSuccess={handleCheckoutPinSuccess}
          onClose={cancelPendingAction}
        />
      )}

      {lastReceipt && (
        <ReceiptModal receipt={lastReceipt} onClose={dismissReceipt} onPrint={() => void printReceiptNow()} />
      )}
    </div>
  );
}
