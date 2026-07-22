import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { getRangeForFilter, type CustomRange } from "@/lib/dateHelpers";
import { PAYMENT_BADGE_CLASS, STATUS_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import { printService } from "@/services/hardware/printService";
import { voidSale, type VoidSaleFailureReason } from "@/services/refundService";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { PaymentMethod, Profile, Sale } from "@/types/db";

const SETTINGS_ID = "default";
const SALES_LIMIT = 200;

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];
const STATUS_FILTERS = ["all", "completed", "pending_sync", "conflict_warning", "refunded"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

// A subset of dateHelpers' TimeRangeFilter -- this audit page only needs
// today/yesterday/custom (plus "all", which that type doesn't have a
// concept of), not the dashboard's 7/30-day rollups.
const DATE_FILTERS = ["all", "today", "yesterday", "custom"] as const;
type DateFilter = (typeof DATE_FILTERS)[number];

const VOID_ERROR_KEY = {
  "not-authorized": "admin.salesHistory.voidErrorNotAuthorized",
  "not-found": "admin.salesHistory.voidErrorNotFound",
  "already-refunded": "admin.salesHistory.voidErrorAlreadyRefunded",
  "unknown-error": "admin.salesHistory.voidErrorGeneric",
} as const satisfies Record<VoidSaleFailureReason, string>;

const NEUTRAL_BUTTON_CLASS =
  "rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50";

const PILL_CLASS = (active: boolean) =>
  `rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
    active ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface2 text-muted hover:text-foreground"
  }`;

function shortId(saleId: string): string {
  return saleId.slice(0, 6).toUpperCase();
}

export function SalesHistoryPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

  const [searchTerm, setSearchTerm] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<PaymentMethod | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [customRange, setCustomRange] = useState<CustomRange>({ start: "", end: "" });
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sales = useLiveQuery(() => db.sales.orderBy("created_at").reverse().limit(SALES_LIMIT).toArray(), []);

  const cashierNames = useLiveQuery(
    () => db.profiles.toArray().then((profiles) => new Map(profiles.map((p) => [p.id, p.full_name]))),
    [],
  );

  const expandedItems = useLiveQuery(async () => {
    if (!expandedSaleId) return null;
    const [items, products] = await Promise.all([
      db.sale_items.where("sale_id").equals(expandedSaleId).toArray(),
      db.products.toArray(),
    ]);
    const productNames = new Map(products.map((p) => [p.id, p.name]));
    return items.map((item) => ({ ...item, productName: productNames.get(item.product_id) }));
  }, [expandedSaleId]);

  const dateRange = useMemo(() => {
    if (dateFilter === "all") return null;
    if (dateFilter === "custom" && (!customRange.start || !customRange.end)) return null;
    return getRangeForFilter(dateFilter, dateFilter === "custom" ? customRange : undefined).current;
  }, [dateFilter, customRange]);

  const filteredSales = useMemo(() => {
    if (!sales) return undefined;
    const term = searchTerm.trim().toLowerCase();

    return sales.filter((sale) => {
      if (paymentFilter !== "all" && sale.payment_method !== paymentFilter) return false;
      if (statusFilter !== "all" && sale.status !== statusFilter) return false;
      if (term) {
        const cashierName = cashierNames?.get(sale.cashier_id) ?? "";
        const matchesId = sale.id.toLowerCase().includes(term);
        const matchesCashier = cashierName.toLowerCase().includes(term);
        if (!matchesId && !matchesCashier) return false;
      }
      if (dateRange && (sale.created_at < dateRange.start || sale.created_at > dateRange.end)) return false;
      return true;
    });
  }, [sales, paymentFilter, statusFilter, searchTerm, dateRange, cashierNames]);

  const handleReprint = async (sale: Sale) => {
    setBusyId(sale.id);
    try {
      const items = await db.sale_items.where("sale_id").equals(sale.id).toArray();
      const settings = await db.local_settings.get(SETTINGS_ID);
      await printService.printReceipt(sale, items, settings?.printMode ?? "browser");
      showToast("success", t("admin.salesHistory.reprintToast"));
    } catch (error) {
      console.warn("[SalesHistoryPage] reprint failed", error);
      showToast("error", t("admin.salesHistory.reprintError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleShare = async (sale: Sale) => {
    // Targets the share-receipt edge function (Phase 9.3), not the PWA route
    // directly -- that function is what detects a social-scraper User-Agent
    // and serves populated Open Graph/Twitter Card tags, so a link shared to
    // WhatsApp/Telegram shows a rich preview instead of a bare client shell
    // with no meta tags at all. Same fix already applied in ReceiptPage.tsx.
    const shareUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/share-receipt?id=${sale.id}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: t("admin.salesHistory.shareTitle"),
          text: t("admin.salesHistory.shareText", { id: shortId(sale.id), amount: formatCurrency(sale.total_amount) }),
          url: shareUrl,
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.warn("[SalesHistoryPage] share failed", error);
        }
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("success", t("admin.salesHistory.shareLinkCopiedToast"));
    } catch (error) {
      console.warn("[SalesHistoryPage] clipboard copy failed", error);
      showToast("error", t("admin.salesHistory.shareError"));
    }
  };

  const handleVoid = async (sale: Sale, profile?: Profile) => {
    if (!profile) return;
    setBusyId(sale.id);
    try {
      const result = await voidSale(sale.id, profile.id);
      if (result.success) {
        if (result.usedFallback) {
          void triggerManualSync();
          showToast("warning", t("sync.offlineFallbackToast"));
        }
        showToast("success", t("admin.salesHistory.voidSuccessToast"));
      } else {
        showToast("error", t(VOID_ERROR_KEY[result.message ?? "unknown-error"]));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <CardCustom title={t("admin.salesHistory.title")}>
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("admin.salesHistory.searchPlaceholder")}
              className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
            />
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value as PaymentMethod | "all")}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
            >
              <option value="all">{t("admin.salesHistory.allPaymentMethods")}</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(`pos.cart.paymentMethod.${method}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((status) => (
              <button key={status} type="button" onClick={() => setStatusFilter(status)} className={PILL_CLASS(statusFilter === status)}>
                {status === "all" ? t("admin.salesHistory.allStatuses") : t(`admin.salesHistory.status.${status}`)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {DATE_FILTERS.map((option) => (
              <button key={option} type="button" onClick={() => setDateFilter(option)} className={PILL_CLASS(dateFilter === option)}>
                {option === "all" ? t("admin.salesHistory.allDates") : t(`admin.dashboard.range.${option}`)}
              </button>
            ))}
            {dateFilter === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customRange.start}
                  onChange={(e) => setCustomRange((current) => ({ ...current, start: e.target.value }))}
                  className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm text-foreground"
                />
                <span className="text-muted">→</span>
                <input
                  type="date"
                  value={customRange.end}
                  onChange={(e) => setCustomRange((current) => ({ ...current, end: e.target.value }))}
                  className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm text-foreground"
                />
              </div>
            )}
          </div>
        </div>

        {filteredSales === undefined ? (
          <p className="text-sm text-muted">{t("admin.salesHistory.loading")}</p>
        ) : filteredSales.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.salesHistory.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3" />
                  <th className="py-2 pr-3">{t("admin.salesHistory.columnDate")}</th>
                  <th className="py-2 pr-3">{t("admin.salesHistory.columnSaleId")}</th>
                  <th className="py-2 pr-3">{t("admin.salesHistory.columnCashier")}</th>
                  <th className="py-2 pr-3">{t("admin.salesHistory.columnPayment")}</th>
                  <th className="py-2 pr-3">{t("admin.salesHistory.columnStatus")}</th>
                  <th className="py-2 pr-3">{t("admin.salesHistory.columnTotal")}</th>
                  <th className="py-2 text-right">{t("admin.salesHistory.columnActions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => {
                  const isExpanded = expandedSaleId === sale.id;
                  const isRefunded = sale.status === "refunded";
                  const isBusy = busyId === sale.id;

                  return (
                    <Fragment key={sale.id}>
                      <tr className="border-b border-border">
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
                            aria-label={t("admin.salesHistory.itemsTitle")}
                            className="text-muted hover:text-foreground"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" aria-hidden />
                            ) : (
                              <ChevronRight className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                        </td>
                        <td className="py-2 pr-3 text-muted">{new Date(sale.created_at).toLocaleString()}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-foreground">#{shortId(sale.id)}</td>
                        <td className="py-2 pr-3 text-foreground">{cashierNames?.get(sale.cashier_id) ?? sale.cashier_id}</td>
                        <td className="py-2 pr-3">
                          <span className={PAYMENT_BADGE_CLASS[sale.payment_method]}>
                            {t(`pos.cart.paymentMethod.${sale.payment_method}`)}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={STATUS_BADGE_CLASS[sale.status]}>{t(`admin.salesHistory.status.${sale.status}`)}</span>
                        </td>
                        <td className="py-2 pr-3 font-semibold text-foreground">{formatCurrency(sale.total_amount)}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" disabled={isBusy} onClick={() => void handleReprint(sale)} className={NEUTRAL_BUTTON_CLASS}>
                              {t("admin.salesHistory.reprint")}
                            </button>
                            <button type="button" onClick={() => void handleShare(sale)} className={NEUTRAL_BUTTON_CLASS}>
                              {t("admin.salesHistory.share")}
                            </button>
                            {!isRefunded && (
                              <ButtonCustom
                                variant="danger"
                                size="sm"
                                disabled={isBusy}
                                requiresAdminPin
                                pinModalTitle={t("admin.salesHistory.voidPinTitle")}
                                onClick={(profile) => void handleVoid(sale, profile)}
                              >
                                {t("admin.salesHistory.void")}
                              </ButtonCustom>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b border-border bg-surface2">
                          <td colSpan={8} className="p-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                              {t("admin.salesHistory.itemsTitle")}
                            </p>
                            {expandedItems === undefined || expandedItems === null ? (
                              <p className="text-xs text-muted">{t("admin.salesHistory.loading")}</p>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {expandedItems.map((item) => (
                                  <li key={item.id} className="flex justify-between text-xs text-foreground">
                                    <span>
                                      {item.quantity} x {item.productName ?? t("admin.salesHistory.unknownProduct")} ·{" "}
                                      {formatCurrency(item.unit_price)}
                                    </span>
                                    <span>{formatCurrency(item.quantity * item.unit_price)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardCustom>
    </div>
  );
}
