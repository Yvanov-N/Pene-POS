import type { PaymentMethod, SaleStatus } from "@/types/db";

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

// Shared between SalesHistoryPage and StudentProfileDrawer (a sale's purchase
// history is shown in both places and should read the same way in either).
// SaleStatus is a pure business enum now (types/db.ts) -- "is this synced
// yet" no longer lives here at all, so there's no amber/red "still syncing"
// state to render for this field specifically anymore (see
// SyncStatusIndicator for that).
export const STATUS_BADGE_CLASS: Record<SaleStatus, string> = {
  completed: "badge-green",
  refunded: "badge-red",
};
