import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { mapSaleRow, writeBackIfNewer } from "@/services/sync/pull";
import { usePaginatedQuery, type PageParams, type PageResult } from "@/hooks/usePaginatedQuery";
import { PaginationControls } from "@/components/admin/PaginationControls";
import { usePageSize } from "@/hooks/usePageSize";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { useShareReceipt } from "@/hooks/useShareReceipt";
import { formatCurrency } from "@/lib/currency";
import { getRangeForFilter, type CustomRange } from "@/lib/dateHelpers";
import { STATUS_BADGE_CLASS } from "@/lib/paymentMethodStyles";
import { matchesSaleSearch } from "@/lib/salesSearch";
import { printService } from "@/services/hardware/printService";
import { voidSale, type VoidSaleFailureReason } from "@/services/refundService";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { PaymentChip } from "@/components/ui/payment-chip";
import type { Database } from "@/types/supabase";
import type { PaymentMethod, Profile, Sale } from "@/types/db";

const SETTINGS_ID = "default";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "momo_mtn", "momo_orange", "student_wallet"];
const STATUS_FILTERS = ["all", "completed", "refunded"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

interface SalesFilters_ {
  paymentFilter: PaymentMethod | "all";
  statusFilter: StatusFilter;
  dateRange: { start: string; end: string } | null;
}

// Local fallback (offline, or the server attempt timed out/failed) -- same
// filter logic this page always had, minus the old hard SALES_LIMIT=200
// truncation (which previously ran BEFORE filtering, so a search/date-range
// query could silently miss real matches beyond row 200 -- fixed here as a
// side effect of building real pagination).
async function queryLocalSales(params: PageParams<"created_at", SalesFilters_>): Promise<PageResult<Sale>> {
  const term = params.searchTerm.trim().toLowerCase();
  const [sales, profiles, students, products] = await Promise.all([
    db.sales.orderBy("created_at").reverse().toArray(),
    db.profiles.toArray(),
    db.student_wallets.toArray(),
    term ? db.products.toArray() : Promise.resolve([]),
  ]);
  const matchingProductIds = products.filter((p) => p.name.toLowerCase().includes(term)).map((p) => p.id);
  const productItems =
    matchingProductIds.length > 0 ? await db.sale_items.where("product_id").anyOf(matchingProductIds).toArray() : [];
  const searchContext = {
    cashierNames: new Map(profiles.map((p) => [p.id, p.full_name])),
    studentNames: new Map(students.map((s) => [s.id, s.student_name])),
    saleIdsWithMatchingProduct: new Set(productItems.map((item) => item.sale_id)),
  };

  const filtered = sales.filter((sale) => {
    if (params.filters.paymentFilter !== "all" && sale.payment_method !== params.filters.paymentFilter) return false;
    if (params.filters.statusFilter !== "all" && sale.status !== params.filters.statusFilter) return false;
    if (!matchesSaleSearch(sale, term, searchContext)) return false;
    if (params.filters.dateRange && (sale.created_at < params.filters.dateRange.start || sale.created_at > params.filters.dateRange.end)) {
      return false;
    }
    return true;
  });

  const offset = (params.page - 1) * params.pageSize;
  return { rows: filtered.slice(offset, offset + params.pageSize), totalCount: filtered.length };
}

// Server path. Reads the sales_search view (migration 00037): plain sales
// rows plus product_names, so a product-name search stays one paginated
// query. sales.id is uuid (no ilike operator) -- id_text (migration 00020)
// is the generated text column that makes id substring search possible. Cashier- and student-name search are two-step resolutions:
// resolve matching profile/student ids first, then OR them into the sales
// filter alongside id_text.
async function fetchServerSales(
  params: PageParams<"created_at", SalesFilters_>,
  signal: AbortSignal,
): Promise<PageResult<Sale>> {
  const term = params.searchTerm.trim().replace(/[%,()]/g, "");

  let matchingCashierIds: string[] = [];
  let matchingStudentIds: string[] = [];
  if (term) {
    const [cashiers, students] = await Promise.all([
      supabase.from("profiles").select("id").ilike("full_name", `%${term}%`).abortSignal(signal),
      // Archived students included on purpose -- their past sales still
      // belong to them.
      supabase.from("student_wallets").select("id").ilike("student_name", `%${term}%`).abortSignal(signal),
    ]);
    if (cashiers.error) throw cashiers.error;
    if (students.error) throw students.error;
    matchingCashierIds = cashiers.data.map((row) => row.id);
    matchingStudentIds = students.data.map((row) => row.id);
  }

  let query = supabase.from("sales_search").select("*", { count: "exact" });
  if (params.filters.paymentFilter !== "all") query = query.eq("payment_method", params.filters.paymentFilter);
  if (params.filters.statusFilter !== "all") query = query.eq("status", params.filters.statusFilter);
  if (params.filters.dateRange) {
    query = query.gte("created_at", params.filters.dateRange.start).lte("created_at", params.filters.dateRange.end);
  }
  if (term) {
    const cashierClause = matchingCashierIds.length > 0 ? `,cashier_id.in.(${matchingCashierIds.join(",")})` : "";
    const studentClause = matchingStudentIds.length > 0 ? `,student_id.in.(${matchingStudentIds.join(",")})` : "";
    query = query.or(
      `id_text.ilike.%${term}%${cashierClause}${studentClause},device_label.ilike.%${term}%,product_names.ilike.%${term}%`,
    );
  }

  const offset = (params.page - 1) * params.pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + params.pageSize - 1)
    .abortSignal(signal);
  if (error) throw error;
  // View columns are all typed nullable, but every row is a real sales row.
  const rows = data as unknown as Database["public"]["Tables"]["sales"]["Row"][];
  return { rows: rows.map(mapSaleRow), totalCount: count ?? 0 };
}

async function writeBackSales(rows: Sale[]): Promise<void> {
  await writeBackIfNewer(db.sales, rows, (row) => row);
}

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
  const { prepareShareUrl } = useShareReceipt();
  const { triggerManualSync, isOnline } = useSyncEngine();

  // ?q= lets other screens (the product detail drawer) open this page
  // already filtered on a sale.
  const [searchParams] = useSearchParams();
  const [searchTermState, setSearchTermState] = useState(() => searchParams.get("q") ?? "");
  const [paymentFilter, setPaymentFilterState] = useState<PaymentMethod | "all">("all");
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilterState] = useState<DateFilter>("all");
  const [customRange, setCustomRangeState] = useState<CustomRange>({ start: "", end: "" });
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("sales");

  // Any search/filter/date change while on page 3 could otherwise land on
  // an empty page -- every setter below also resets back to page 1.
  const searchTerm = searchTermState;
  const setSearchTerm = (value: string) => {
    setSearchTermState(value);
    setPage(1);
  };
  const setPaymentFilter = (value: PaymentMethod | "all") => {
    setPaymentFilterState(value);
    setPage(1);
  };
  const setStatusFilter = (value: StatusFilter) => {
    setStatusFilterState(value);
    setPage(1);
  };
  const setDateFilter = (value: DateFilter) => {
    setDateFilterState(value);
    setPage(1);
  };
  const setCustomRange = (updater: (current: CustomRange) => CustomRange) => {
    setCustomRangeState(updater);
    setPage(1);
  };

  const cashierNames = useLiveQuery(
    () => db.profiles.toArray().then((profiles) => new Map(profiles.map((p) => [p.id, p.full_name]))),
    [],
  );

  const localStudentNames = useLiveQuery(
    () => db.student_wallets.toArray().then((students) => new Map(students.map((s) => [s.id, s.student_name]))),
    [],
  );
  // Archived students are dropped from Dexie by the soft-delete pull, but
  // their old sales still need a name -- fetch just the ids on this page
  // that the local table can't resolve.
  const [remoteStudentNames, setRemoteStudentNames] = useState<Map<string, string>>(new Map());
  // Ids already asked for, found or not -- so an id the server doesn't
  // return either isn't refetched on every render.
  const requestedStudentIds = useRef(new Set<string>());

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

  const {
    rows: filteredSales,
    totalCount,
    totalPages,
  } = usePaginatedQuery({
    params: {
      page,
      pageSize,
      searchTerm,
      sortKey: "created_at",
      sortDir: "desc",
      filters: { paymentFilter, statusFilter, dateRange },
    },
    queryLocal: queryLocalSales,
    fetchServer: fetchServerSales,
    writeBack: writeBackSales,
  });

  useEffect(() => {
    if (!filteredSales || !localStudentNames || !isOnline) return;
    const missing = [
      ...new Set(
        filteredSales
          .map((sale) => sale.student_id)
          .filter((id): id is string => !!id && !localStudentNames.has(id) && !requestedStudentIds.current.has(id)),
      ),
    ];
    if (missing.length === 0) return;
    for (const id of missing) requestedStudentIds.current.add(id);
    void supabase
      .from("student_wallets")
      .select("id, student_name")
      .in("id", missing)
      .then(({ data, error }) => {
        if (error || !data) return;
        setRemoteStudentNames((current) => {
          const next = new Map(current);
          for (const row of data) next.set(row.id, row.student_name);
          return next;
        });
      });
  }, [filteredSales, localStudentNames, isOnline]);

  const studentName = (studentId: string) =>
    localStudentNames?.get(studentId) ?? remoteStudentNames.get(studentId) ?? t("admin.salesHistory.unknownStudent");

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
    // prepareShareUrl (useShareReceipt) is what actually gates this: a sale
    // that isn't confirmed server-side yet gets synced on demand before a
    // link is ever generated, rather than handing out a link that might be
    // dead and hoping the recipient's client retries it into existence. It
    // returns null (having already shown a toast explaining why) if sharing
    // isn't currently possible.
    setBusyId(sale.id);
    try {
      const shareUrl = await prepareShareUrl(sale.id);
      if (!shareUrl) return;

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
    } finally {
      setBusyId(null);
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

  const toggleExpanded = (saleId: string) => setExpandedSaleId((current) => (current === saleId ? null : saleId));

  const paymentChip = (sale: Sale) => (
    <PaymentChip
      method={sale.payment_method}
      studentName={sale.payment_method === "student_wallet" && sale.student_id ? studentName(sale.student_id) : undefined}
    />
  );

  // Another payment method can still be attributed to a student (CRM tag) --
  // that name stays under the chip; a wallet sale has it inside the chip.
  const attributedStudent = (sale: Sale) =>
    sale.student_id && sale.payment_method !== "student_wallet" ? (
      <p className="mt-1 text-xs text-muted">{studentName(sale.student_id)}</p>
    ) : null;

  const renderActions = (sale: Sale) => {
    const isBusy = busyId === sale.id;
    return (
      <>
        <button type="button" disabled={isBusy} onClick={() => void handleReprint(sale)} className={NEUTRAL_BUTTON_CLASS}>
          {t("admin.salesHistory.reprint")}
        </button>
        <button type="button" disabled={isBusy} onClick={() => void handleShare(sale)} className={NEUTRAL_BUTTON_CLASS}>
          {t("admin.salesHistory.share")}
        </button>
        {sale.status !== "refunded" && (
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
      </>
    );
  };

  const renderItems = () =>
    expandedItems === undefined || expandedItems === null ? (
      <p className="text-xs text-muted">{t("admin.salesHistory.loading")}</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {expandedItems.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 text-xs text-foreground">
            <span>
              {item.quantity} x {item.productName ?? t("admin.salesHistory.unknownProduct")} · {formatCurrency(item.unit_price)}
            </span>
            <span className="shrink-0">{formatCurrency(item.quantity * item.unit_price)}</span>
          </li>
        ))}
      </ul>
    );

  // Round, bordered icon button so it reads as "this opens" -- the arrow
  // shows the direction: right/down on desktop rows, down/up on mobile cards.
  const expandButtonClass =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface2 text-foreground hover:border-accent";

  return (
    <div className="table-page">
      <CardCustom className="table-card" title={t("admin.salesHistory.title")}>
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("admin.salesHistory.searchPlaceholder")}
              className="w-full flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
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

          {/* One scrollable row on a phone instead of wrapping into a tall block. */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`${PILL_CLASS(statusFilter === status)} shrink-0`}
              >
                {status === "all" ? t("admin.salesHistory.allStatuses") : t(`admin.salesHistory.status.${status}`)}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
              {DATE_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDateFilter(option)}
                  className={`${PILL_CLASS(dateFilter === option)} shrink-0`}
                >
                  {option === "all" ? t("admin.salesHistory.allDates") : t(`admin.dashboard.range.${option}`)}
                </button>
              ))}
            </div>
            {dateFilter === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customRange.start}
                  onChange={(e) => setCustomRange((current) => ({ ...current, start: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm text-foreground"
                />
                <span className="text-muted">→</span>
                <input
                  type="date"
                  value={customRange.end}
                  onChange={(e) => setCustomRange((current) => ({ ...current, end: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm text-foreground"
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
          <div className="table-scroll">
            {/* Phones: one card per sale instead of an 860px table to scroll sideways. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {filteredSales.map((sale) => {
                const isExpanded = expandedSaleId === sale.id;
                return (
                  <li key={sale.id} className="rounded-lg border border-border">
                    <div className="flex flex-col gap-2 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-muted">{new Date(sale.created_at).toLocaleString()}</p>
                          <p className="font-mono text-xs text-foreground">#{shortId(sale.id)}</p>
                        </div>
                        <p className="shrink-0 text-base font-semibold text-foreground">{formatCurrency(sale.total_amount)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {paymentChip(sale)}
                        <span className={STATUS_BADGE_CLASS[sale.status]}>{t(`admin.salesHistory.status.${sale.status}`)}</span>
                      </div>
                      {attributedStudent(sale)}
                      <p className="truncate text-xs text-muted">
                        {sale.device_label ?? cashierNames?.get(sale.cashier_id) ?? sale.cashier_id}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(sale.id)}
                          aria-expanded={isExpanded}
                          className="mr-auto flex items-center gap-2 text-xs font-medium text-foreground"
                        >
                          <span className={expandButtonClass} aria-hidden>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </span>
                          {isExpanded ? t("admin.salesHistory.hideItems") : t("admin.salesHistory.showItems")}
                        </button>
                        {renderActions(sale)}
                      </div>
                    </div>
                    {isExpanded && <div className="border-t border-border bg-surface2 p-3">{renderItems()}</div>}
                  </li>
                );
              })}
            </ul>

            <div className="hidden md:block">
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
                    return (
                      <Fragment key={sale.id}>
                        <tr className="border-b border-border">
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(sale.id)}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? t("admin.salesHistory.hideItems") : t("admin.salesHistory.showItems")}
                              title={isExpanded ? t("admin.salesHistory.hideItems") : t("admin.salesHistory.showItems")}
                              className={expandButtonClass}
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
                          <td className="py-2 pr-3 text-foreground">
                            {sale.device_label ?? cashierNames?.get(sale.cashier_id) ?? sale.cashier_id}
                          </td>
                          <td className="py-2 pr-3">
                            {paymentChip(sale)}
                            {attributedStudent(sale)}
                          </td>
                          <td className="py-2 pr-3">
                            <span className={STATUS_BADGE_CLASS[sale.status]}>{t(`admin.salesHistory.status.${sale.status}`)}</span>
                          </td>
                          <td className="py-2 pr-3 font-semibold text-foreground">{formatCurrency(sale.total_amount)}</td>
                          <td className="py-2">
                            <div className="flex flex-wrap justify-end gap-2">{renderActions(sale)}</div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="border-b border-border bg-surface2">
                            <td colSpan={8} className="p-3">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                {t("admin.salesHistory.itemsTitle")}
                              </p>
                              {renderItems()}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {filteredSales !== undefined && totalCount > 0 && (
          <PaginationControls
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
        )}
        {!isOnline && <p className="mt-2 text-xs text-muted">{t("admin.pagination.offlineNotice")}</p>}
      </CardCustom>
    </div>
  );
}
