import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { Receipt as ReceiptIcon, Share2, Printer } from "lucide-react";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { PAYMENT_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import logo from "@/assets/logo.png";
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
  studentName: string | null;
  items: ReceiptItem[];
}

interface PublicReceiptRow {
  id: string;
  created_at: string;
  payment_method: PaymentMethod;
  total_amount: number;
  status: SaleStatus;
  cashier_name: string | null;
  student_name: string | null;
  items: { product_name: string | null; quantity: number; unit_price: number }[];
}

// Distinguishes "still checking local Dexie" (undefined) from "checked, not
// found here" ({ found: false }) -- a plain useLiveQuery returning bare
// `Sale | undefined` can't tell those two apart, and that ambiguity is
// exactly what decides whether to fall back to the public RPC below.
type LocalLookup = { found: true; data: ReceiptData } | { found: false };

const LOCALE_BY_LANGUAGE: Record<string, string> = { fr: "fr-FR", en: "en-US" };

function shortSaleId(saleId: string): string {
  return saleId.slice(0, 6).toUpperCase();
}

function ReceiptSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="animate-pulse">
      <span className="sr-only">{t("receiptPage.loading")}</span>
      <div className="mx-auto mb-4 h-6 w-32 rounded bg-surface2" />
      <div className="mx-auto mb-6 h-3 w-40 rounded bg-surface2" />
      <div className="flex flex-col gap-2 border-t border-dashed border-border pt-3">
        <div className="h-3 w-full rounded bg-surface2" />
        <div className="h-3 w-5/6 rounded bg-surface2" />
        <div className="h-3 w-4/6 rounded bg-surface2" />
      </div>
      <div className="mt-4 h-8 w-full rounded bg-surface2" />
    </div>
  );
}

// Some share-target apps flatten navigator.share()'s separate title/text/url
// fields into one string before this app ever sees it back (a documented
// Android Web Share intent-merging quirk, not something this app's own code
// can fully prevent -- see the fix to admin.salesHistory.shareText for the
// specific trigger). Extracting just the UUID means a mangled param like
// "8bfa72da-...-14c8646396ae Purchase receipt" still resolves the real
// receipt instead of a false "not found".
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractSaleId(raw: string | undefined): string | undefined {
  return raw?.match(UUID_PATTERN)?.[0];
}

export function ReceiptPage() {
  const { saleId: rawSaleId } = useParams<{ saleId: string }>();
  const saleId = extractSaleId(rawSaleId);
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();

  // undefined = not attempted yet, null = attempted and no sale found,
  // ReceiptData = found via the public RPC.
  const [remoteReceipt, setRemoteReceipt] = useState<ReceiptData | null | undefined>(undefined);

  const localResult = useLiveQuery<LocalLookup>(async () => {
    if (!saleId) return { found: false };
    const sale = await db.sales.get(saleId);
    if (!sale) return { found: false };

    const [items, cashier, student, products] = await Promise.all([
      db.sale_items.where("sale_id").equals(saleId).toArray(),
      db.profiles.get(sale.cashier_id),
      sale.student_id ? db.student_wallets.get(sale.student_id) : Promise.resolve(undefined),
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
        studentName: student?.student_name ?? null,
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
  // the public get_public_receipt RPC (migration 6, extended in migration 9
  // for student_name), which anon can call. Deliberately NOT the literal
  // `supabase.from('sales').select('*, sale_items(*), profiles(*))` this
  // phase's spec shows: anon has zero table grants on sales/sale_items/
  // profiles by design (see migration 1) -- that call would return nothing
  // for exactly the anonymous-visitor case it's meant to handle. The RPC is
  // the narrow, already-safe exception built for this.
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
          studentName: row.student_name,
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

  const buildShareUrl = () =>
    // The share-receipt edge function (Phase 9.3) -- it detects real humans
    // by User-Agent and 302s them straight to this same /receipt/:saleId
    // route, but gives social scrapers (WhatsApp, Telegram, etc.) populated
    // Open Graph / Twitter Card meta tags instead, so a shared link shows a
    // rich preview with the actual amount and items in the chat app. Not
    // this phase's literal `${window.location.origin}/receipt/${sale.id}`
    // placeholder -- that's the pre-9.3 stand-in this exact file already
    // moved on from once the real endpoint existed.
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/share-receipt?id=${saleId}`;

  const handleShare = async () => {
    if (!saleId || !receipt) return;
    const shareUrl = buildShareUrl();

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

  const locale = LOCALE_BY_LANGUAGE[i18n.language] ?? LOCALE_BY_LANGUAGE.fr;
  const timestamp = receipt
    ? t("receiptPage.timestampFormat", {
        date: new Date(receipt.createdAt).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" }),
        time: new Date(receipt.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      })
    : "";

  return (
    <div className="min-h-screen bg-background p-4 sm:flex sm:items-center sm:justify-center">
      <div className="mx-auto w-full sm:max-w-[380px]">
        <CardCustom className="receipt-card">
          {isLoading ? (
            <ReceiptSkeleton />
          ) : notFound ? (
            <div className="py-6 text-center">
              <ReceiptIcon className="mx-auto h-10 w-10 text-muted" aria-hidden />
              <p className="mt-3 text-sm font-semibold text-foreground">{t("receiptPage.notFoundTitle")}</p>
              <p className="mt-1 text-xs text-muted">{t("receiptPage.notFound")}</p>
            </div>
          ) : (
            receipt && (
              <>
                <div className="mb-3 flex flex-col items-center text-center">
                  <img src={logo} alt="" className="mb-2 h-8 w-auto object-contain" />
                  <p className="text-sm font-semibold text-foreground">{t("receipt.shopName")}</p>
                  <p className="text-xs text-muted">{timestamp}</p>
                  <p className="font-mono text-xs text-muted">#{shortSaleId(receipt.id)}</p>
                </div>

                <div className="flex flex-col gap-1 border-t border-dashed border-border pt-3 font-mono">
                  {receipt.items.map((item, index) => (
                    <div key={index} className="flex justify-between text-xs text-foreground">
                      <span className="truncate pr-2">
                        {item.quantity} x {item.productName}
                      </span>
                      <span className="shrink-0">{formatCurrency(item.quantity * item.unitPrice)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-dashed border-border pt-3">
                  <span className={PAYMENT_BADGE_CLASS[receipt.paymentMethod]}>
                    {t(`pos.cart.paymentMethod.${receipt.paymentMethod}`)}
                  </span>
                  <span className="font-mono text-base font-bold text-foreground">
                    {formatCurrency(receipt.totalAmount)}
                  </span>
                </div>

                {receipt.status === "refunded" && (
                  <p className="mt-2 text-center text-xs text-destructive">
                    {t("admin.salesHistory.status.refunded")}
                  </p>
                )}

                {receipt.studentName && (
                  <p className="mt-2 text-center">
                    <span className="badge-green">{t("receiptPage.studentLabel", { name: receipt.studentName })}</span>
                  </p>
                )}

                {receipt.cashierName && (
                  <p className="mt-2 text-center text-xs text-muted">
                    {t("receipt.cashier", { name: receipt.cashierName })}
                  </p>
                )}

                <div className="receipt-actions mt-4 flex gap-2">
                  <ButtonCustom variant="primary" className="flex-1" onClick={() => void handleShare()}>
                    <Share2 className="h-4 w-4" aria-hidden />
                    {t("receiptPage.share")}
                  </ButtonCustom>
                  <ButtonCustom variant="primary" className="flex-1" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" aria-hidden />
                    {t("receiptPage.print")}
                  </ButtonCustom>
                </div>
              </>
            )
          )}
        </CardCustom>
      </div>
    </div>
  );
}
