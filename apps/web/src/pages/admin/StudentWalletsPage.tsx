import { useEffect, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { mapWalletRow, writeBackIfNewer } from "@/services/sync/pull";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { usePaginatedQuery, type PageParams, type PageResult } from "@/hooks/usePaginatedQuery";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { isRevenueRelevant } from "@/lib/salesAggregation";
import { notTakenByOther, numberSchema } from "@/lib/validation";
import { MoMoVerificationCard } from "@/components/admin/MoMoVerificationCard";
import { PaginationControls } from "@/components/admin/PaginationControls";
import { StudentProfileDrawer } from "@/components/admin/wallets/StudentProfileDrawer";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import { Switch } from "@/components/ui/switch";
import type { StudentWallet } from "@/types/db";

const PAGE_SIZE = 25;
type WalletFilters_ = Record<string, never>;

// Local fallback (offline, or the server attempt timed out/failed) -- same
// filter/sort this page always did, sliced to the requested page.
async function queryLocalWallets(params: PageParams<"student_name", WalletFilters_>): Promise<PageResult<StudentWallet>> {
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
  const sorted = [...filtered].sort((a, b) => a.student_name.localeCompare(b.student_name));
  const offset = (params.page - 1) * params.pageSize;
  return { rows: sorted.slice(offset, offset + params.pageSize), totalCount: sorted.length };
}

async function fetchServerWallets(
  params: PageParams<"student_name", WalletFilters_>,
  signal: AbortSignal,
): Promise<PageResult<StudentWallet>> {
  const offset = (params.page - 1) * params.pageSize;
  let query = supabase.from("student_wallets").select("*", { count: "exact" });
  const term = params.searchTerm.trim().replace(/[%,()]/g, "");
  if (term) {
    query = query.or(
      `student_name.ilike.%${term}%,badge_code.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`,
    );
  }
  const { data, error, count } = await query
    .order("student_name", { ascending: true })
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
  const setSearchTerm = (value: string) => {
    setSearchTermState(value);
    setPage(1); // a changed search term while on page 3 could otherwise land on an empty page
  };
  const [selectedStudent, setSelectedStudent] = useState<StudentWallet | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
      balance: numberSchema(t("admin.students.errorBalanceInvalid")),
      email: Yup.string(),
      phone: Yup.string(),
    }),
    onSubmit: async (values) => {
      const studentName = values.student_name.trim();
      const badgeCode = values.badge_code.trim();
      const balance = Number(values.balance);

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
    params: { page, pageSize: PAGE_SIZE, searchTerm, sortKey: "student_name", sortDir: "asc", filters: {} },
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
  const statsByStudent = useLiveQuery(async () => {
    const sales = await db.sales.toArray();
    const map = new Map<string, { totalSpend: number; orderCount: number }>();
    for (const sale of sales.filter(isRevenueRelevant)) {
      if (!sale.student_id) continue;
      const bucket = map.get(sale.student_id) ?? { totalSpend: 0, orderCount: 0 };
      bucket.totalSpend += sale.total_amount;
      bucket.orderCount += 1;
      map.set(sale.student_id, bucket);
    }
    return map;
  }, []);

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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <CardCustom
        title={t("admin.students.title")}
        header={
          <ButtonCustom variant="primary" size="sm" onClick={openCreateForm}>
            {t("admin.students.add")}
          </ButtonCustom>
        }
      >
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t("admin.wallets.searchPlaceholder")}
          className="mb-4 w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
        />

        {visibleStudents === undefined ? (
          <p className="text-sm text-muted">{t("admin.students.loading")}</p>
        ) : visibleStudents.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.students.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">{t("admin.students.fieldName")}</th>
                  <th className="py-2 pr-3">{t("admin.students.fieldBadge")}</th>
                  <th className="py-2 pr-3">{t("admin.students.fieldEmail")}</th>
                  <th className="py-2 pr-3">{t("admin.students.fieldPhone")}</th>
                  <th className="py-2 pr-3">{t("admin.wallets.columnEmailOptIn")}</th>
                  <th className="py-2 pr-3">{t("admin.wallets.columnBalance")}</th>
                  <th className="py-2 pr-3">{t("admin.wallets.columnTotalSpend")}</th>
                  <th className="py-2 pr-3">{t("admin.wallets.columnOrders")}</th>
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
                      <td className="py-2 pr-3 font-medium text-foreground">{student.student_name}</td>
                      <td className="py-2 pr-3 text-muted">{student.badge_code}</td>
                      <td className="py-2 pr-3 text-muted">{student.email || "—"}</td>
                      <td className="py-2 pr-3 text-muted">{student.phone || "—"}</td>
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
                      <td className="py-2 pr-3 text-foreground">{formatCurrency(stats?.totalSpend ?? 0)}</td>
                      <td className="py-2 pr-3 text-foreground">{stats?.orderCount ?? 0}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(student);
                          }}
                          className="rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                        >
                          {t("admin.students.edit")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {visibleStudents !== undefined && totalCount > 0 && (
          <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
        )}
        {!isOnline && <p className="mt-2 text-xs text-muted">{t("admin.pagination.offlineNotice")}</p>}
      </CardCustom>

      <MoMoVerificationCard />

      {selectedStudent && (
        <StudentProfileDrawer student={selectedStudent} onClose={() => setSelectedStudent(null)} />
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
                  <input
                    type="number"
                    step="1"
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
