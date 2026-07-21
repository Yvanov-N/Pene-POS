import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/currency";
import { MoMoVerificationCard } from "@/components/admin/MoMoVerificationCard";
import { StudentProfileDrawer } from "@/components/admin/wallets/StudentProfileDrawer";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { Switch } from "@/components/ui/switch";
import type { Sale, StudentWallet } from "@/types/db";

// Same revenue-relevance rule duplicated in useDashboardAnalytics.ts and
// StudentProfileDrawer.tsx -- a rejected MoMo sale or a refunded sale must
// not inflate a student's lifetime spend/order count.
function isRevenueRelevant(sale: Sale): boolean {
  return (sale.status === "completed" || sale.status === "pending_sync") && sale.momo_verification_status !== "rejected";
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
  const { triggerManualSync } = useSyncEngine();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentWallet | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A second handleSave invocation landing before the first has re-rendered
  // (e.g. a fast double click) would read stale `saving` state and pass its
  // own duplicate-badge check before either write has landed -- the second
  // write then flags the first's own just-created row as a duplicate. Same
  // fix as ProductFormDrawer.tsx's savingRef; a ref mutates synchronously so
  // it actually closes that window, where state doesn't.
  const savingRef = useRef(false);

  const students = useLiveQuery(() => db.student_wallets.toArray(), []);

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

  const visibleStudents = useMemo(() => {
    if (!students) return undefined;
    const term = searchTerm.trim().toLowerCase();
    const filtered = term
      ? students.filter(
          (s) =>
            s.student_name.toLowerCase().includes(term) ||
            s.badge_code.toLowerCase().includes(term) ||
            s.email.toLowerCase().includes(term) ||
            s.phone.toLowerCase().includes(term),
        )
      : students;
    return [...filtered].sort((a, b) => a.student_name.localeCompare(b.student_name));
  }, [students, searchTerm]);

  const openCreateForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const setEmailOptIn = async (walletId: string, value: boolean) => {
    await db.student_wallets.update(walletId, { email_opt_in: value });
    await enqueueMutation("UPDATE", "student_wallets", { id: walletId, email_opt_in: value });
    void triggerManualSync();
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
    setForm(walletToForm(wallet));
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    try {
      const studentName = form.student_name.trim();
      const badgeCode = form.badge_code.trim();
      const balance = Number(form.balance);

      if (!studentName) {
        setFormError(t("admin.students.errorNameRequired"));
        return;
      }
      if (!badgeCode) {
        setFormError(t("admin.students.errorBadgeRequired"));
        return;
      }
      if (!Number.isFinite(balance)) {
        setFormError(t("admin.students.errorBalanceInvalid"));
        return;
      }

      const existingWithBadge = await db.student_wallets.where("badge_code").equals(badgeCode).first();
      if (existingWithBadge && existingWithBadge.id !== editingId) {
        setFormError(t("admin.students.errorBadgeTaken"));
        return;
      }

      // Preserve the existing email_opt_in preference on edit -- this form
      // has no field for it (the directory table's own Switch column owns
      // that), so without this, editing a name/balance would silently reset
      // a student's opt-out back to true every time.
      const existing = editingId ? await db.student_wallets.get(editingId) : undefined;

      setFormError(null);
      const wallet: StudentWallet = {
        id: editingId ?? crypto.randomUUID(),
        student_name: studentName,
        badge_code: badgeCode,
        balance,
        email: form.email.trim(),
        email_opt_in: existing?.email_opt_in ?? true,
        phone: form.phone.trim(),
      };

      await db.student_wallets.put(wallet);
      await enqueueMutation(editingId ? "UPDATE" : "INSERT", "student_wallets", { ...wallet });
      void triggerManualSync();

      showToast("success", t(editingId ? "admin.wallets.updateSuccessToast" : "admin.wallets.createSuccessToast", { name: studentName }));
      setFormOpen(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
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
                  value={form.student_name}
                  onChange={(e) => setForm({ ...form, student_name: e.target.value })}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.students.fieldBadge")}</span>
                  <input
                    type="text"
                    value={form.badge_code}
                    onChange={(e) => setForm({ ...form, badge_code: e.target.value })}
                    className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.students.fieldBalance")}</span>
                  <input
                    type="number"
                    step="1"
                    value={form.balance}
                    onChange={(e) => setForm({ ...form, balance: e.target.value })}
                    className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.students.fieldEmail")}</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.students.fieldPhone")}</span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>

              {formError && <p className="text-xs text-destructive">{formError}</p>}

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground disabled:opacity-50"
                >
                  {t("admin.students.formCancel")}
                </button>
                <ButtonCustom variant="primary" className="flex-1" isLoading={saving} onClick={() => void handleSave()}>
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
