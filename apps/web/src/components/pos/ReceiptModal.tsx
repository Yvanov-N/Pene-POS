import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Printer, Share2 } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { PAYMENT_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import { useShareReceipt } from "@/hooks/useShareReceipt";
import { useToast } from "@/hooks/useToast";
import logo from "@/assets/logo.png";
import type { CompletedReceipt } from "@/hooks/usePosCheckout";

const LOCALE_BY_LANGUAGE: Record<string, string> = { fr: "fr-FR", en: "en-US" };

function shortSaleId(saleId: string): string {
  return saleId.slice(0, 6).toUpperCase();
}

interface ReceiptModalProps {
  receipt: CompletedReceipt;
  onClose: () => void;
  onPrint: () => void;
}

// Shown after every sale by default (replacing the old silent auto-print) --
// mirrors ReceiptPage.tsx's own receipt layout so a cashier sees the exact
// same shape here and on a shared link, just as a dismissable modal instead
// of a standalone route, and built entirely from data usePosCheckout already
// has in memory (no Dexie/RPC round trip the way ReceiptPage.tsx needs for a
// fresh, possibly-anonymous visit).
export function ReceiptModal({ receipt, onClose, onPrint }: ReceiptModalProps) {
  const { t, i18n } = useTranslation();
  const { sale, cartItems, cashierName, studentName } = receipt;
  const { prepareShareUrl } = useShareReceipt();
  const { showToast } = useToast();
  const [isSharing, setIsSharing] = useState(false);

  const locale = LOCALE_BY_LANGUAGE[i18n.language] ?? LOCALE_BY_LANGUAGE.fr;
  const timestamp = t("receiptPage.timestampFormat", {
    date: new Date(sale.created_at).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: new Date(sale.created_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
  });

  // Mirrors ReceiptPage.tsx's own handleShare -- same share-target/clipboard
  // fallback shape, just fed from the in-memory sale this modal already has
  // instead of a freshly-fetched one.
  const handleShare = async () => {
    setIsSharing(true);
    try {
      const shareUrl = await prepareShareUrl(sale.id);
      if (!shareUrl) return; // prepareShareUrl already showed a toast explaining why

      if (navigator.share) {
        try {
          await navigator.share({
            title: t("receiptPage.shareTitle"),
            text: t("receiptPage.shareText", { amount: formatCurrency(sale.total_amount) }),
            url: shareUrl,
          });
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            console.warn("[ReceiptModal] share failed", error);
          }
        }
        return;
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("success", t("receiptPage.linkCopiedToast"));
      } catch (error) {
        console.warn("[ReceiptModal] clipboard copy failed", error);
        showToast("error", t("receiptPage.shareError"));
      }
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full sm:max-w-[380px]">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 rounded-full bg-surface p-1.5 text-muted shadow hover:text-foreground"
          aria-label={t("pos.pin.close")}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <CardCustom className="receipt-modal-card max-h-[85vh] overflow-y-auto">
          <div className="mb-3 flex flex-col items-center text-center">
            <img src={logo} alt="" className="mb-2 h-8 w-auto object-contain" />
            <p className="text-sm font-semibold text-foreground">{t("pos.receipt.title")}</p>
            <p className="text-xs text-muted">{t("receipt.shopName")}</p>
            <p className="text-xs text-muted">{timestamp}</p>
            <p className="font-mono text-xs text-muted">#{shortSaleId(sale.id)}</p>
          </div>

          <div className="flex flex-col gap-1 border-t border-dashed border-border pt-3 font-mono">
            {cartItems.map((item) => (
              <div key={item.id} className="flex justify-between text-xs text-foreground">
                <span className="truncate pr-2">
                  {item.quantity} x {item.name}
                </span>
                <span className="shrink-0">{formatCurrency(item.quantity * item.price)}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-dashed border-border pt-3">
            <span className={PAYMENT_BADGE_CLASS[sale.payment_method]}>
              {t(`pos.cart.paymentMethod.${sale.payment_method}`)}
            </span>
            <span className="font-mono text-base font-bold text-foreground">{formatCurrency(sale.total_amount)}</span>
          </div>

          {studentName && (
            <p className="mt-2 text-center">
              <span className="badge-green">{t("receiptPage.studentLabel", { name: studentName })}</span>
            </p>
          )}

          <p className="mt-2 text-center text-xs text-muted">{t("receipt.cashier", { name: cashierName })}</p>

          <div className="receipt-actions mt-4 flex gap-2">
            <ButtonCustom variant="primary" className="flex-1" onClick={onPrint}>
              <Printer className="h-4 w-4" aria-hidden />
              {t("pos.receipt.printButton")}
            </ButtonCustom>
            <ButtonCustom variant="primary" className="flex-1" isLoading={isSharing} onClick={() => void handleShare()}>
              <Share2 className="h-4 w-4" aria-hidden />
              {t("pos.receipt.shareButton")}
            </ButtonCustom>
            <ButtonCustom variant="primary" className="flex-1" onClick={onClose}>
              {t("pos.receipt.closeButton")}
            </ButtonCustom>
          </div>
        </CardCustom>
      </div>
    </div>
  );
}
