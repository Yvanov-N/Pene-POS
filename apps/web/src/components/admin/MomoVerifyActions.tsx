import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/useToast";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { formatCurrency } from "@/lib/currency";
import { confirmMomoSale, rejectMomoSale } from "@/services/momoVerification";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Profile, Sale } from "@/types/db";
import { CheckCircle2, XCircle } from "lucide-react";

const VOID_ERROR_KEY = {
  "not-authorized": "admin.salesHistory.voidErrorNotAuthorized",
  "not-found": "admin.salesHistory.voidErrorNotFound",
  "already-refunded": "admin.salesHistory.voidErrorAlreadyRefunded",
  "unknown-error": "admin.salesHistory.voidErrorGeneric",
} as const;

interface MomoVerifyActionsProps {
  sale: Sale;
  onDone?: (outcome: "confirmed" | "rejected") => void;
}

// "SMS received" / "Reject" for one pending Mobile Money sale -- shared by the
// verification card (Students page), the POS verification modal and the
// receipt. Rejecting cancels the sale, so it asks for an admin PIN, like
// "Cancel / Refund" in the sales history.
export function MomoVerifyActions({ sale, onDone }: MomoVerifyActionsProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await confirmMomoSale(sale.id);
      showToast("success", t("admin.momo.confirmedToast", { amount: formatCurrency(sale.total_amount) }));
      onDone?.("confirmed");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (profile?: Profile) => {
    if (!profile) return;
    setBusy(true);
    try {
      const result = await rejectMomoSale(sale.id, profile.id);
      if (!result.success) {
        showToast("error", t(VOID_ERROR_KEY[result.message ?? "unknown-error"]));
        return;
      }
      if (result.usedFallback) {
        void triggerManualSync();
        showToast("warning", t("sync.offlineFallbackToast"));
      }
      showToast("error", t("admin.momo.rejectedToast"));
      onDone?.("rejected");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <ButtonCustom variant="success" size="sm" className="w-full" disabled={busy} onClick={() => void handleConfirm()}>
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("admin.momo.confirm")}
      </ButtonCustom>
      <ButtonCustom
        variant="danger"
        size="sm"
        className="w-full"
        disabled={busy}
        requiresAdminPin
        pinModalTitle={t("admin.momo.rejectPinTitle")}
        onClick={(profile) => void handleReject(profile)}
      >
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("admin.momo.reject")}
      </ButtonCustom>
    </div>
  );
}
