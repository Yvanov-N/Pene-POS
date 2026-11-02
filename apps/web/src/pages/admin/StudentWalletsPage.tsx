import { useEffect, useMemo, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, Pencil, X } from "lucide-react";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { mapWalletRow, writeBackIfNewer } from "@/services/sync/pull";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { listArchivedWallets, type ArchivedStudentWallet } from "@/services/sync/walletHistory";
import { usePaginatedQuery, type PageParams, type PageResult } from "@/hooks/usePaginatedQuery";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { isRevenueRelevant } from "@/lib/salesAggregation";
import { MONEY_DECIMALS, notTakenByOther, numberSchema } from "@/lib/validation";
import { MoMoVerificationCard } from "@/components/admin/MoMoVerificationCard";
import { PaginationControls } from "@/components/admin/PaginationControls";
import { SortableTh } from "@/components/admin/SortableTh";
import { useTableSort } from "@/hooks/useTableSort";
import { sortRows, type SortDir } from "@/lib/sorting";
import { usePageSize } from "@/hooks/usePageSize";
import { StudentProfileDrawer } from "@/components/admin/wallets/StudentProfileDrawer";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import { Switch } from "@/components/ui/switch";
import type { StudentWallet } from "@/types/db";
import { AmountInput } from "@/components/ui/amount-input";
import { parseAmount } from "@/lib/money";

type WalletFilters_ = Record<string, never>;
type StudentSortKey = "name" | "badge" | "email" | "phone" | "optIn" | "balance" | "spend" | "orders";
type ArchivedSortKey = "name" | "badge" | "balance";

const SERVER_SORT_COLUMN: Record<StudentSortKey, string> = {
  name: "student_name",
  badge: "badge_code",
  email: "email",
  phone: "phone",
  optIn: "email_opt_in",
  balance: "balance",
  // Computed from sales locally -- the server page just follows name order.
  spend: "student_name",
  orders: "student_name",
};

const FIRST_DIR: Partial<Record<StudentSortKey, SortDir>> = { balance: "desc", spend: "desc", orders: "desc" };

interface StudentStats {
  totalSpend: number;
  orderCount: number;
}

// Spend and order count per student, from revenue-relevant local sales -- used
// by the table cells and by the "total spent"/"orders" sorts.
async function computeStudentStats(): Promise<Map<string, StudentStats>> {
  const sales = await db.sales.toArray();
  const map = new Map<string, StudentStats>();
  for (const sale of sales.filter(isRevenueRelevant)) {
    if (!sale.student_id) continue;
    const bucket = map.get(sale.student_id) ?? { totalSpend: 0, orderCount: 0 };
    bucket.totalSpend += sale.total_amount;
    bucket.orderCount += 1;
    map.set(sale.student_id, bucket);
  }
  return map;
}

// Local fallback (offline, or the server attempt timed out/failed) -- same
// filter/sort this page always did, sliced to the requested page.
async function queryLocalWallets(params: PageParams<StudentSortKey, WalletFilters_>): Promise<PageResult<StudentWallet>> {
  const all = await db.student_wallets.toArray();
  const term = params.searchTerm.trim().toLowerCase();
  const filtered = term
    ? all.filter(
        (s) =>
          s.student_name.toLowerCase().includes(term) ||
          s.badge_code.toLowerCase().includes(term) ||
          s.email.toLowerCase().includes(term) ||
          s.phone.toLowerCase().includes(term),
      )
    : all;
  const stats = params.sortKey === "spend" || params.sortKey === "orders" ? await computeStudentStats() : null;
  const sortValue = (s: StudentWallet) => {
    switch (params.sortKey) {
      case "name":
        return s.student_name;
      case "badge":
        return s.badge_code;
      case "email":
        return s.email;
      case "phone":
        return s.phone;
      case "optIn":
        return s.email_opt_in;
      case "balance":
        return s.balance;
      case "spend":
        return stats?.get(s.id)?.totalSpend ?? 0;
      case "orders":
        return stats?.get(s.id)?.orderCount ?? 0;
    }
  };
  const sorted = sortRows(filtered, sortValue, params.sortDir);
  const offset = (params.page - 1) * params.pageSize;
  return { rows: sorted.slice(offset, offset + params.pageSize), totalCount: sorted.length };
}

async function fetchServerWallets(
  params: PageParams<StudentSortKey, WalletFilters_>,
  signal: AbortSignal,
): Promise<PageResult<StudentWallet>> {
  const offset = (params.page - 1) * params.pageSize;
  // deleted_at is null: an archived student (migration 00035) must not
  // reappear in the normal active list/search -- see "Show archived" below
  // for the dedicated view that does list them.
  let query = supabase.from("student_wallets").select("*", { count: "exact" }).is("deleted_at", null);
  const term = params.searchTerm.trim().replace(/[%,()]/g, "");
  if (term) {
    query = query.or(
      `student_name.ilike.%${term}%,badge_code.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`,
    );
  }
  const { data, error, count } = await query
    .order(SERVER_SORT_COLUMN[params.sortKey], { ascending: params.sortDir === "asc" })
    .range(offset, offset + params.pageSize - 1)
    .abortSignal(signal);
  if (error) throw error;
  return { rows: data.map(mapWalletRow), totalCount: count ?? 0 };
}

async function writeBackWallets(rows: StudentWallet[]): Promise<void> {
  await writeBackIfNewer(db.student_wallets, rows, (row) => row);
}

interface FormState {
  student_name: string;
  badge_code: string;
  balance: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: FormState = { student_name: "", badge_code: "", balance: "0", email: "", phone: "" };

function walletToForm(wallet: StudentWallet): FormState {
  return {
    student_name: wallet.student_name,
    badge_code: wallet.badge_code,
    balance: String(wallet.balance),
    email: wallet.email,
    phone: wallet.phone,
  };
}

export function StudentWalletsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { isOnline } = useSyncEngine();

  const [searchTerm, setSearchTermState] = useState("");
  const [page, setPage] = useState(1);
  const { sortKey, sortDir, toggleSort } = useTableSort<StudentSortKey>("name", "asc", FIRST_DIR, () => setPage(1));
  const archivedSort = useTableSort<ArchivedSortKey>("name", "asc", { balance: "desc" });
  const [pageSize, setPageSize] = usePageSize("students");
  const setSearchTerm = (value: string) => {
    setSearchTermState(value);
    setPage(1); // a changed search term while on page 3 could otherwise land on an empty page
  };
  const [selectedStudent, setSelectedStudent] = useState<StudentWallet | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Archived students are a separate, always-live view (not paginated
  // through usePaginatedQuery/local Dexie the way the active list is) --
  // an archived row is, by the same soft-delete convention as
  // products/categories, absent from local Dexie entirely, so there's no
  // offline-first local source to page through here.
  const [showArchived, setShowArchived] = useState(false);
  const [archivedStudents, setArchivedStudents] = useState<ArchivedStudentWallet[] | undefined>(undefined);
  const [selectedArchivedStudent, setSelectedArchivedStudent] = useState<ArchivedStudentWallet | null>(null);

  const loadArchivedStudents = async () => {
    setArchivedStudents(await listArchivedWallets(searchTerm));
  };

  useEffect(() => {
    if (showArchived) void loadArchivedStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, searchTerm]);

  const formik = useFormik<FormState>({
    initialValues: EMPTY_FORM,
    validateOnChange: false,
    validateOnBlur: true,
    validationSchema: Yup.object({
      student_name: Yup.string().trim().required(t("admin.students.errorNameRequired")),
      badge_code: Yup.string()
        .trim()
        .required(t("admin.students.errorBadgeRequired"))
        .test("unique-badge-code", t("admin.students.errorBadgeTaken"), async (value) => {
          const trimmed = value?.trim();
          if (!trimmed) return true;
          const existing = await db.student_wallets.where("badge_code").equals(trimmed).first();
          return notTakenByOther(existing, editingId ?? undefined);
        }),
      // No min/moreThan -- debt (a negative balance) is a valid state here.
      balance: numberSchema(t("admin.students.errorBalanceInvalid"), { decimals: MONEY_DECIMALS }),
      email: Yup.string(),
      phone: Yup.string(),
    }),
    onSubmit: async (values) => {
      const studentName = values.student_name.trim();
      const badgeCode = values.badge_code.trim();
      const balance = parseAmount(values.balance);

      // Preserve the existing email_opt_in preference on edit -- this form
      // has no field for it (the directory table's own Switch column owns
      // that), so without this, editing a name/balance would silently reset
      // a student's opt-out back to true every time.
      const existing = editingId ? await db.student_wallets.get(editingId) : undefined;

      const wallet: StudentWallet = {
        id: editingId ?? crypto.randomUUID(),
        student_name: studentName,
        badge_code: badgeCode,
        balance,
        email: values.email.trim(),
        email_opt_in: existing?.email_opt_in ?? true,
        phone: values.phone.trim(),
        updated_at: new Date().toISOString(),
      };

      const entry = makeOutboxEntry(editingId ? "generic_update" : "generic_insert", "student_wallets", {
        ...wallet,
      });
      await commitLocal(db.student_wallets, () => db.student_wallets.put(wallet), entry);
      void pushOutbox(entry);

      showToast("success", t(editingId ? "admin.wallets.updateSuccessToast" : "admin.wallets.createSuccessToast", { name: studentName }));
      setFormOpen(false);
    },
  });

  const { rows: visibleStudents, totalCount, totalPages } = usePaginatedQuery({
    params: { page, pageSize, searchTerm, sortKey, sortDir, filters: {} },
    queryLocal: queryLocalWallets,
    fetchServer: fetchServerWallets,
    writeBack: writeBackWallets,
  });

  // A dedicated page with no product scanning happening on it at all --
  // unlike PosCart's checkout picker, any scan here is unambiguously a
  // student badge, matching StudentWalletRechargeCard's original pattern.
  useEffect(() => {
    const handleScan = (event: Event) => {
      const code = (event as CustomEvent<string>).detail;
      if (code) setSearchTerm(code);
    };
    window.addEventListener("pos:barcode-scan", handleScan);
    return () => window.removeEventListener("pos:barcode-scan", handleScan);
  }, []);

  // One full-table aggregation pass rather than a per-student query -- a
  // campus shop's sales table is small enough that this is cheap, and it
  // avoids an O(students x sales) nested-query pattern.
  const statsByStudent = useLiveQuery(computeStudentStats, []);

  const sortedArchived = useMemo(() => {
    if (!archivedStudents) return undefined;
    const get = (s: ArchivedStudentWallet) =>
      archivedSort.sortKey === "name" ? s.student_name : archivedSort.sortKey === "badge" ? s.badge_code : s.balance;
    return sortRows(archivedStudents, get, archivedSort.sortDir);
  }, [archivedStudents, archivedSort.sortKey, archivedSort.sortDir]);

  const openCreateForm = () => {
    setEditingId(null);
    formik.resetForm({ values: EMPTY_FORM });
    setFormOpen(true);
  };

  const setEmailOptIn = async (walletId: string, value: boolean) => {
    const entry = makeOutboxEntry("generic_update", "student_wallets", { id: walletId, email_opt_in: value });
    await commitLocal(db.student_wallets, () => db.student_wallets.update(walletId, { email_opt_in: value }), entry);
    void pushOutbox(entry);
  };

  const handleToggleEmailOptIn = async (wallet: StudentWallet) => {
    const previousValue = wallet.email_opt_in;
    const nextValue = !previousValue;
    await setEmailOptIn(wallet.id, nextValue);
    showToast("success", t("admin.wallets.emailOptToggleToast", { name: wallet.student_name }), undefined, {
      label: t("admin.wallets.undo"),
      onClick: () => void setEmailOptIn(wallet.id, previousValue),
    });
  };

  const openEditForm = (wallet: StudentWallet) => {
    setEditingId(wallet.id);
    formik.resetForm({ values: walletToForm(wallet) });
    setFormOpen(true);
  };

  // No "blocked if has sales" guard, unlike ProductsPage.tsx's handleDelete
  // -- archiving a student WITH purchase/wallet history is the entire point
  // here, not an edge case to avoid. The soft-delete (deleted_at UPDATE, not
  // a real DELETE -- migration 00035) keeps every sale/sale_item/
  // sync_operations row referencing this wallet intact either way.
  const handleArchive = async (wallet: StudentWallet) => {
    const entry = makeOutboxEntry("generic_delete", "student_wallets", { id: wallet.id });
    await commitLocal(db.student_wallets, () => db.student_wallets.delete(wallet.id), entry);
    void pushOutbox(entry);
    showToast("success", t("admin.students.archiveSuccessToast", { name: wallet.student_name }));
  };

  const handleRestore = async (wallet: ArchivedStudentWallet) => {
    const entry = makeOutboxEntry("generic_update", "student_wallets", { id: wallet.id, deleted_at: null });
    // Re-inserts the full row locally (it's currently absent from Dexie, by
    // the same "absent = deleted" convention as products/categories) --
    // already in hand from the archived list's own fetch, so this is a
    // plain put(), not a partial update().
    const { deleted_at: _deletedAt, ...restored } = wallet;
    await commitLocal(db.student_wallets, () => db.student_wallets.put(restored), entry);
    void pushOutbox(entry);
    showToast("success", t("admin.students.restoreSuccessToast", { name: wallet.student_name }));
    void loadArchivedStudents();
  };

  const sortTh = (column: StudentSortKey, label: string, className?: string) => (
    <SortableTh column={column} label={label} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={className} />
  );

  // Arriving from the POS Mobile Money reminder: bring the verification card
  // into view (on phones it sits below the one-screen-tall table).
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "#momo") {
      document.getElementById("momo-verification")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [hash]);

  return (
    // Phones/tablets: the table card is one screen tall and the MoMo card
    // follows below it. xl+: table 8/12 at full height, MoMo 4/12 beside it.
    <div className="flex h-full w-full flex-col gap-4 p-4 xl:grid xl:grid-cols-12 xl:grid-rows-[minmax(0,1fr)]">
      <CardCustom
        className="flex h-full min-h-0 min-w-0 shrink-0 flex-col xl:col-span-8"
        title={showArchived ? t("admin.students.archivedTitle") : t("admin.students.title")}
        header={
          showArchived ? (
            <ButtonCustom variant="primary" size="sm" onClick={() => setShowArchived(false)}>
              {t("admin.students.backToActive")}
            </ButtonCustom>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
              >
                {t("admin.students.showArchived")}
              </button>
              <ButtonCustom variant="primary" size="sm" onClick={openCreateForm}>
                {t("admin.students.add")}
              </ButtonCustom>
            </div>
          )
        }
      >
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t("admin.wallets.searchPlaceholder")}
          className="mb-4 w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
        />

        {showArchived ? (
          archivedStudents === undefined ? (
            <p className="text-sm text-muted">{t("admin.students.loading")}</p>
          ) : archivedStudents.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.students.archivedEmpty")}</p>
          ) : (
            <div className="table-scroll">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <SortableTh column="name" label={t("admin.students.fieldName")} sortKey={archivedSort.sortKey} sortDir={archivedSort.sortDir} onSort={archivedSort.toggleSort} />
                    <SortableTh column="badge" label={t("admin.students.fieldBadge")} sortKey={archivedSort.sortKey} sortDir={archivedSort.sortDir} onSort={archivedSort.toggleSort} />
                    <SortableTh column="balance" label={t("admin.wallets.columnBalance")} sortKey={archivedSort.sortKey} sortDir={archivedSort.sortDir} onSort={archivedSort.toggleSort} />
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(sortedArchived ?? []).map((student) => (
                    <tr
                      key={student.id}
                      onClick={() => setSelectedArchivedStudent(student)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface2"
                    >
                      <td className="py-2 pr-3 font-medium text-foreground">{student.student_name}</td>
                      <td className="py-2 pr-3 text-muted">{student.badge_code}</td>
                      <td
                        className={`whitespace-nowrap py-2 pr-3 font-medium ${student.balance > 0 ? "text-success" : student.balance < 0 ? "text-destructive" : "text-foreground"}`}
                      >
                        {formatCurrency(student.balance)}
                      </td>
                      <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => void handleRestore(student)}
                          className="rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                        >
                          {t("admin.students.restore")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : visibleStudents === undefined ? (
          <p className="text-sm text-muted">{t("admin.students.loading")}</p>
        ) : visibleStudents.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.students.empty")}</p>
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  {sortTh("name", t("admin.students.fieldName"))}
                  {sortTh("badge", t("admin.students.fieldBadge"))}
                  {/* E-mail/phone only on very wide screens -- the table shares the
                      row with the MoMo card from xl up; both are in the student drawer. */}
                  {sortTh("email", t("admin.students.fieldEmail"), "hidden 2xl:table-cell")}
                  {sortTh("phone", t("admin.students.fieldPhone"), "hidden 2xl:table-cell")}
                  {sortTh("optIn", t("admin.wallets.columnEmailOptIn"))}
                  {sortTh("balance", t("admin.wallets.columnBalance"))}
                  {sortTh("spend", t("admin.wallets.columnTotalSpend"))}
                  {sortTh("orders", t("admin.wallets.columnOrders"))}
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => {
                  const stats = statsByStudent?.get(student.id);
                  return (
                    <tr
                      key={student.id}
                      onClick={() => setSelectedStudent(student)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface2"
                    >
                      <td className="whitespace-nowrap py-2 pr-3 font-medium text-foreground">{student.student_name}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-muted">{student.badge_code}</td>
                      <td className="hidden py-2 pr-3 text-muted 2xl:table-cell">{student.email || "—"}</td>
                      <td className="hidden py-2 pr-3 text-muted 2xl:table-cell">{student.phone || "—"}</td>
                      <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={student.email_opt_in}
                          onChange={() => void handleToggleEmailOptIn(student)}
                          aria-label={t("admin.wallets.columnEmailOptIn")}
                        />
                      </td>
                      <td
                        className={`py-2 pr-3 font-medium ${student.balance > 0 ? "text-success" : student.balance < 0 ? "text-destructive" : "text-foreground"}`}
                      >
                        {formatCurrency(student.balance)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-foreground">{formatCurrency(stats?.totalSpend ?? 0)}</td>
                      <td className="py-2 pr-3 text-foreground">{stats?.orderCount ?? 0}</td>
                      <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        {/* Icon buttons: the table shares its row with the MoMo
                            card, so the labelled ones no longer fit. */}
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(student)}
                            aria-label={t("admin.students.edit")}
                            title={t("admin.students.edit")}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface2 text-foreground hover:border-accent"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <ButtonCustom
                            variant="danger"
                            size="icon"
                            requiresAdminPin
                            pinModalTitle={t("admin.students.archivePinTitle")}
                            aria-label={t("admin.students.archive")}
                            title={t("admin.students.archive")}
                            onClick={() => void handleArchive(student)}
                          >
                            <Archive className="h-4 w-4" aria-hidden />
                          </ButtonCustom>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!showArchived && visibleStudents !== undefined && totalCount > 0 && (
          <PaginationControls
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
        )}
        {!showArchived && !isOnline && <p className="mt-2 text-xs text-muted">{t("admin.pagination.offlineNotice")}</p>}
      </CardCustom>

      <div id="momo-verification" className="min-w-0 scroll-mt-4 xl:col-span-4 xl:self-start">
        <MoMoVerificationCard />
      </div>

      {selectedStudent && (
        <StudentProfileDrawer student={selectedStudent} onClose={() => setSelectedStudent(null)} />
      )}

      {selectedArchivedStudent && (
        <StudentProfileDrawer
          student={selectedArchivedStudent}
          onClose={() => setSelectedArchivedStudent(null)}
          isArchived
        />
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                {editingId ? t("admin.students.editTitle") : t("admin.students.addTitle")}
              </h2>
              <button type="button" onClick={() => setFormOpen(false)} className="text-muted hover:text-foreground" aria-label={t("pos.pin.close")}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.students.fieldName")}</span>
                <input
                  type="text"
                  name="student_name"
                  value={formik.values.student_name}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
                <FieldError touched={formik.touched.student_name} error={formik.errors.student_name} />
              </label>
              <div className="flex gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.students.fieldBadge")}</span>
                  <input
                    type="text"
                    name="badge_code"
                    value={formik.values.badge_code}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className="w-full min-w-0 rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                  <FieldError touched={formik.touched.badge_code} error={formik.errors.badge_code} />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.students.fieldBalance")}</span>
                  <AmountInput
                    name="balance"
                    value={formik.values.balance}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    className="w-full min-w-0 rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                  <FieldError touched={formik.touched.balance} error={formik.errors.balance} />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.students.fieldEmail")}</span>
                <input
                  type="email"
                  name="email"
                  value={formik.values.email}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.students.fieldPhone")}</span>
                <input
                  type="tel"
                  name="phone"
                  value={formik.values.phone}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={formik.isSubmitting}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground disabled:opacity-50"
                >
                  {t("admin.students.formCancel")}
                </button>
                <ButtonCustom
                  variant="primary"
                  className="flex-1"
                  isLoading={formik.isSubmitting}
                  onClick={() => void formik.submitForm()}
                >
                  {t("admin.students.formSave")}
                </ButtonCustom>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
