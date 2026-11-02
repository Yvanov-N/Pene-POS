import { useTranslation } from "react-i18next";
import { PAYMENT_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import type { PaymentMethod } from "@/types/db";

interface PaymentChipProps {
  method: PaymentMethod;
  // Shown inside the chip for a student-wallet sale ("Portefeuille · Awa").
  studentName?: string;
}

// Payment badge shared by the sales history and the product detail drawer.
// The badge-* classes are inline-flex, so truncation lives on an inner span.
export function PaymentChip({ method, studentName }: PaymentChipProps) {
  const { t } = useTranslation();
  const label =
    method === "student_wallet" && studentName
      ? t("admin.salesHistory.walletChip", { name: studentName })
      : t(`pos.cart.paymentMethod.${method}`);

  return (
    <span className={`${PAYMENT_BADGE_CLASS[method]} max-w-[14rem] whitespace-nowrap`} title={label}>
      <span className="truncate">{label}</span>
    </span>
  );
}
