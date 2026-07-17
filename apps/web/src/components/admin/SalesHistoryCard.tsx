import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { printService } from "@/services/hardware/printService";
import { voidSale, type VoidSaleFailureReason } from "@/services/refundService";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { PaymentMethod, Profile, Sale, SaleStatus } from "@/types/db";

interface SalesHistoryCardProps {
  onClose: () => void;
}

const SETTINGS_ID = "default";
const SALES_LIMIT = 200;

const PAYMENT_FILTERS = ["all", "cash", "momo_mtn", "momo_orange", "student_wallet"] as const;
type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

const PAYMENT_BADGE_CLASS: Record<PaymentMethod, string> = {
  cash: "badge-blue",
  momo_mtn: "badge-amber",
  momo_orange: "badge-orange",
  student_wallet: "badge-green",
};

const STATUS_BADGE_CLASS: Record<SaleStatus, string> = {
  completed: "badge-green",
  pending_sync: "badge-amber",
  conflict_warning: "badge-red",
  refunded: "badge-red",
};

const VOID_ERROR_KEY = {
  "not-authorized": "admin.salesHistory.voidErrorNotAuthorized",
  "not-found": "admin.salesHistory.voidErrorNotFound",
  "already-refunded": "admin.salesHistory.voidErrorAlreadyRefunded",
  "unknown-error": "admin.salesHistory.voidErrorGeneric",
} as const satisfies Record<VoidSaleFailureReason, string>;

// A plain UTC slice of created_at would silently shift the selected
// calendar day by the shop's UTC offset -- same reasoning as
// dateHelpers.getTodayTimeRange() (Phase 8.1), just for an arbitrary
// admin-picked date instead of "now". Kept local to this file since it's the
// only consumer that needs an arbitrary-date range rather than today's.
function getLocalDayRange(dateInputValue: string): { start: string; end: string } | null {
  const parts = dateInputValue.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [year, month, day] = parts;
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function SalesHistoryCard({ onClose }: SalesHistoryCardProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [cashierSearch, setCashierSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sales = useLiveQuery(
    () => db.sales.orderBy("created_at").reverse().limit(SALES_LIMIT).toArray(),
    [],
  );

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

  const filteredSales = useMemo(() => {
    if (!sales) return undefined;
    const dateRange = dateFilter ? getLocalDayRange(dateFilter) : null;
    const cashierTerm = cashierSearch.trim().toLowerCase();

    return sales.filter((sale) => {
      if (paymentFilter !== "all" && sale.payment_method !== paymentFilter) return false;
      if (cashierTerm) {
        const name = cashierNames?.get(sale.cashier_id) ?? "";
        if (!name.toLowerCase().includes(cashierTerm)) return false;
      }
      if (dateRange && (sale.created_at < dateRange.start || sale.created_at > dateRange.end)) return false;
      return true;
    });
  }, [sales, paymentFilter, cashierSearch, dateFilter, cashierNames]);

  const handleReprint = async (sale: Sale) => {
    try {
      const items = await db.sale_items.where("sale_id").equals(sale.id).toArray();
      const settings = await db.local_settings.get(SETTINGS_ID);
      await printService.printReceipt(sale, items, settings?.printMode ?? "browser");
      showToast("success", t("admin.salesHistory.reprintToast"));
    } catch (error) {
      console.warn("[SalesHistoryCard] reprint failed", error);
      showToast("error", t("admin.salesHistory.reprintError"));
    }
  };

  const handleVoid = async (sale: Sale, profile?: Profile) => {
    if (!profile) return;
    setBusyId(sale.id);
    try {
      const result = await voidSale(sale.id, profile.id);
      if (result.success) {
        void triggerManualSync();
        showToast("success", t("admin.salesHistory.voidSuccessToast"));
      } else {
        showToast("error", t(VOID_ERROR_KEY[result.message ?? "unknown-error"]));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <CardCustom
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-y-auto"
        title={t("admin.salesHistory.title")}
        header={
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            ✕
          </button>
        }
      >
        <div className="mb-4 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {PAYMENT_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setPaymentFilter(filter)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  paymentFilter === filter
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-surface2 text-muted hover:text-foreground"
                }`}
              >
                {filter === "all" ? t("admin.salesHistory.allPaymentMethods") : t(`pos.cart.paymentMethod.${filter}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={cashierSearch}
              onChange={(e) => setCashierSearch(e.target.value)}
              placeholder={t("admin.salesHistory.cashierSearchPlaceholder")}
              className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
            />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
            />
          </div>
        </div>

        {filteredSales === undefined ? (
          <p className="text-sm text-muted">{t("admin.salesHistory.loading")}</p>
        ) : filteredSales.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.salesHistory.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredSales.map((sale) => {
              const isExpanded = expandedSaleId === sale.id;
              const isRefunded = sale.status === "refunded";
              return (
                <li key={sale.id} className="rounded-lg border border-border p-3">
                  <button
                    type="button"
                    onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={PAYMENT_BADGE_CLASS[sale.payment_method]}>
                        {t(`pos.cart.paymentMethod.${sale.payment_method}`)}
                      </span>
                      <span className={STATUS_BADGE_CLASS[sale.status]}>
                        {t(`admin.salesHistory.status.${sale.status}`)}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {formatCurrency(sale.total_amount)}
                      </span>
                    </div>
                    <span className="text-xs text-muted">
                      {new Date(sale.created_at).toLocaleString()} ·{" "}
                      {cashierNames?.get(sale.cashier_id) ?? sale.cashier_id}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 border-t border-border pt-3">
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
                                {item.quantity} x {item.productName ?? t("admin.salesHistory.unknownProduct")}
                              </span>
                              <span>{formatCurrency(item.quantity * item.unit_price)}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {!isRefunded && (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleReprint(sale)}
                            className="rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                          >
                            {t("admin.salesHistory.reprint")}
                          </button>
                          <ButtonCustom
                            variant="danger"
                            size="sm"
                            disabled={busyId === sale.id}
                            requiresAdminPin
                            pinModalTitle={t("admin.salesHistory.voidPinTitle")}
                            onClick={(profile) => void handleVoid(sale, profile)}
                          >
                            {t("admin.salesHistory.void")}
                          </ButtonCustom>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardCustom>
    </div>
  );
}
