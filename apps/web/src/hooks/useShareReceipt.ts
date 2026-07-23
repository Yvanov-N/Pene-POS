import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import { getIsOnlineSnapshot } from "@/lib/networkStatusStore";
import { confirmSaleSynced, getPendingIds } from "@/services/syncService";
import { useToast } from "@/hooks/useToast";

export function buildShareReceiptUrl(saleId: string): string {
  // The share-receipt edge function (Phase 9.3) -- it detects real humans by
  // User-Agent and 302s them straight to /receipt/:saleId, but gives social
  // scrapers (WhatsApp, Telegram, etc.) populated Open Graph/Twitter Card
  // meta tags instead, so a shared link shows a rich preview in the chat app.
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/share-receipt?id=${saleId}`;
}

// The single place both share entry points (SalesHistoryPage's row action,
// ReceiptPage's own Share button) go through before ever handing out a link.
// A sale can be locally "done" (cashier sees a completed checkout) well
// before it exists in Supabase -- get_public_receipt genuinely, correctly
// returns null for anyone who opens a link to a sale that hasn't landed
// server-side yet. Rather than generate a link that might be dead and hope a
// recipient's client retries it into existence, this confirms the sale is
// actually there first and refuses to produce a link otherwise.
export function useShareReceipt() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  // Returns the share URL to hand to navigator.share()/clipboard, or null if
  // sharing was blocked -- a toast already explains why in that case, so the
  // caller does nothing further. Re-fetches its own db.sales row rather than
  // trusting a caller-passed one, so it works identically whether the caller
  // already has a Sale in hand (SalesHistoryPage) or only a saleId
  // (ReceiptPage, where a remotely-fetched receipt has no local Dexie row at
  // all -- db.sales.get returns undefined there, treated as "nothing to gate,
  // this sale is already confirmed to exist server-side").
  const prepareShareUrl = useCallback(
    async (saleId: string): Promise<string | null> => {
      const sale = await db.sales.get(saleId);

      if (sale?.status === "pending_sync") {
        if (!getIsOnlineSnapshot()) {
          showToast("error", t("shareReceipt.blockedOfflineToast"));
          return null;
        }
        try {
          const outcome = await confirmSaleSynced(saleId);
          if (outcome === "conflict") {
            showToast("error", t("shareReceipt.blockedConflictToast"));
            return null;
          }
        } catch (error) {
          console.warn("[useShareReceipt] confirmSaleSynced failed", error);
          showToast("error", t("shareReceipt.blockedErrorToast"));
          return null;
        }
      } else if (sale?.status === "conflict_warning") {
        // Resolving a conflict (conflictResolver.ts) flips the local status
        // straight back to "completed" without ever re-calling complete_sale
        // -- retrying the push here would just hit the same violation again,
        // so this is a hard stop, not a "try once more" case.
        showToast("error", t("shareReceipt.blockedConflictToast"));
        return null;
      } else if (sale?.status === "refunded") {
        // Voiding a still-pending sale (refundService.ts) deletes its queued
        // push entirely by design, so the sale is deliberately never going to
        // reach the server -- forcing a sync here would wrongly resurrect a
        // voided sale. Keep this the one soft, non-blocking case: still let
        // the link be generated, just warn if a queue entry is somehow still
        // sitting there (stale/edge case), same as the historical behavior.
        const pendingIds = await getPendingIds("sale_id");
        if (pendingIds.has(saleId)) {
          showToast("warning", t("admin.salesHistory.shareUnsyncedHint"));
        }
      }

      return buildShareReceiptUrl(saleId);
    },
    [t, showToast],
  );

  return { prepareShareUrl };
}
