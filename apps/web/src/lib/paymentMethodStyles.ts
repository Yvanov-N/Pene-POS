import type { PaymentMethod } from "@/types/db";

// Shared between SalesHistoryPage and ReceiptPage (a payment method should
// read as the same badge color everywhere) -- moved out of
// SalesHistoryCard.tsx when that component was superseded so a page-level
// component wasn't the canonical home for a cross-cutting UI constant.
export const PAYMENT_BADGE_CLASS: Record<PaymentMethod, string> = {
  cash: "badge-blue",
  momo_mtn: "badge-amber",
  momo_orange: "badge-orange",
  student_wallet: "badge-green",
};
