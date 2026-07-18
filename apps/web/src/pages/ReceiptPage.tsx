import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { PAYMENT_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import type { PaymentMethod, SaleStatus } from "@/types/db";

interface ReceiptItem {
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface ReceiptData {
  id: string;
  createdAt: string;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  status: SaleStatus;
  cashierName: string | null;
  items: ReceiptItem[];
}

interface PublicReceiptRow {
  id: string;
  created_at: string;
  payment_method: PaymentMethod;
  total_amount: number;
  status: SaleStatus;
  cashier_name: string | null;
  items: { product_name: string | null; quantity: number; unit_price: number }[];
}

// Distinguishes "still checking local Dexie" (undefined) from "checked, not
// found here" ({ found: false }) -- a plain useLiveQuery returning bare
// `Sale | undefined` can't tell those two apart, and that ambiguity is
// exactly what decides whether to fall back to the public RPC below.
type LocalLookup = { found: true; data: ReceiptData } | { found: false };

export function ReceiptPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const { t } = useTranslation();
  const { showToast } = useToast();

  // undefined = not attempted yet, null = attempted and no sale found,
  // ReceiptData = found via the public RPC.
  const [remoteReceipt, setRemoteReceipt] = useState<ReceiptData | null | undefined>(undefined);

  const localResult = useLiveQuery<LocalLookup>(async () => {
    if (!saleId) return { found: false };
    const sale = await db.sales.get(saleId);
    if (!sale) return { found: false };

    const [items, cashier, products] = await Promise.all([
      db.sale_items.where("sale_id").equals(saleId).toArray(),
      db.profiles.get(sale.cashier_id),
      db.products.toArray(),
    ]);
    const productNames = new Map(products.map((p) => [p.id, p.name]));

    return {
      found: true,
      data: {
        id: sale.id,
        createdAt: sale.created_at,
        paymentMethod: sale.payment_method,
        totalAmount: sale.total_amount,
        status: sale.status,
        cashierName: cashier?.full_name ?? null,
        items: items.map((item) => ({
          productName: productNames.get(item.product_id) ?? t("admin.salesHistory.unknownProduct"),
          quantity: item.quantity,
          unitPrice: item.unit_price,
        })),
      },
    };
  }, [saleId]);

  // Sale isn't in this device's local Dexie -- either someone else's sale,
  // or a genuinely anonymous visitor with no local data at all. Fall back to
  // the public get_public_receipt RPC (migration 6), which anon can call.
  useEffect(() => {
    if (!saleId || localResult === undefined || localResult.found || remoteReceipt !== undefined) return;

    void supabase
      .rpc("get_public_receipt", { p_sale_id: saleId })
      .then(({ data, error }) => {
        if (error || !data) {
          setRemoteReceipt(null);
          return;
        }
        const row = data as unknown as PublicReceiptRow;
        setRemoteReceipt({
          id: row.id,
          createdAt: row.created_at,
          paymentMethod: row.payment_method,
          totalAmount: row.total_amount,
          status: row.status,
          cashierName: row.cashier_name,
          items: row.items.map((item) => ({
            productName: item.product_name ?? t("admin.salesHistory.unknownProduct"),
            quantity: item.quantity,
            unitPrice: item.unit_price,
          })),
        });
      });
  }, [saleId, localResult, remoteReceipt, t]);

  const receipt = localResult?.found ? localResult.data : (remoteReceipt ?? undefined);
  const isLoading = localResult === undefined || (localResult.found === false && remoteReceipt === undefined);
  const notFound = !isLoading && !receipt;

  const handleShare = async () => {
    if (!saleId || !receipt) return;
    // The share-receipt edge function (Phase 9.3) -- it detects real humans
    // by User-Agent and 302s them straight to this same /receipt/:saleId
    // route, but gives social scrapers (WhatsApp, Telegram, etc.) populated
    // Open Graph / Twitter Card meta tags instead, so a shared link shows a
    // rich preview with the actual amount and items in the chat app.
    const shareUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/share-receipt?id=${saleId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: t("receiptPage.shareTitle"),
          text: t("receiptPage.shareText", { amount: formatCurrency(receipt.totalAmount) }),
          url: shareUrl,
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.warn("[ReceiptPage] share failed", error);
        }
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("success", t("receiptPage.linkCopiedToast"));
    } catch (error) {
      console.warn("[ReceiptPage] clipboard copy failed", error);
      showToast("error", t("receiptPage.shareError"));
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:flex sm:items-center sm:justify-center">
      <div className="mx-auto w-full sm:max-w-[320px]">
        <CardCustom>
          {isLoading ? (
            <p className="text-sm text-muted">{t("receiptPage.loading")}</p>
          ) : notFound ? (
            <p className="text-sm text-muted">{t("receiptPage.notFound")}</p>
          ) : (
            receipt && (
              <>
                <div className="mb-3 text-center">
                  <p className="text-sm font-semibold text-foreground">{t("receipt.shopName")}</p>
                  <p className="text-xs text-muted">{new Date(receipt.createdAt).toLocaleString()}</p>
                </div>

                <div className="border-t border-dashed border-border pt-3">
                  {receipt.items.map((item, index) => (
                    <div key={index} className="mb-1 flex justify-between text-xs text-foreground">
                      <span>
                        {item.quantity} x {item.productName}
                      </span>
                      <span>{formatCurrency(item.quantity * item.unitPrice)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-dashed border-border pt-3">
                  <span className={PAYMENT_BADGE_CLASS[receipt.paymentMethod]}>
                    {t(`pos.cart.paymentMethod.${receipt.paymentMethod}`)}
                  </span>
                  <span className="text-sm font-bold text-foreground">{formatCurrency(receipt.totalAmount)}</span>
                </div>

                {receipt.status === "refunded" && (
                  <p className="mt-2 text-center text-xs text-destructive">
                    {t("admin.salesHistory.status.refunded")}
                  </p>
                )}

                {receipt.cashierName && (
                  <p className="mt-2 text-center text-xs text-muted">
                    {t("receipt.cashier", { name: receipt.cashierName })}
                  </p>
                )}

                <ButtonCustom variant="primary" className="mt-4 w-full" onClick={() => void handleShare()}>
                  {t("receiptPage.share")}
                </ButtonCustom>
              </>
            )
          )}
        </CardCustom>
      </div>
    </div>
  );
}
