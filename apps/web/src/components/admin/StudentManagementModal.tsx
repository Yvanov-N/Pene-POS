import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { formatCurrency } from "@/lib/currency";
import type { StudentWallet } from "@/types/db";

interface StudentManagementModalProps {
  onClose: () => void;
}

type View = "list" | "form";

interface FormState {
  student_name: string;
  badge_code: string;
  balance: string;
  email: string;
}

const EMPTY_FORM: FormState = { student_name: "", badge_code: "", balance: "", email: "" };

function walletToForm(wallet: StudentWallet): FormState {
  return {
    student_name: wallet.student_name,
    badge_code: wallet.badge_code,
    balance: String(wallet.balance),
    email: wallet.email,
  };
}

export function StudentManagementModal({ onClose }: StudentManagementModalProps) {
  const { t } = useTranslation();
  const { triggerManualSync } = useSyncEngine();
  // "student_name" isn't part of the Dexie schema's index list (id,
  // badge_code, email only) -- orderBy("student_name") throws at runtime, so
  // sort in memory instead of adding a schema migration for it.
  const wallets = useLiveQuery(
    () =>
      db.student_wallets.toArray().then((rows) => rows.sort((a, b) => a.student_name.localeCompare(b.student_name))),
    [],
  );

  const [view, setView] = useState<View>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const openCreateForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setView("form");
  };

  const openEditForm = (wallet: StudentWallet) => {
    setEditingId(wallet.id);
    setForm(walletToForm(wallet));
    setFormError(null);
    setView("form");
  };

  const handleSave = async () => {
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
    if (!Number.isFinite(balance) || balance < 0) {
      setFormError(t("admin.students.errorBalanceInvalid"));
      return;
    }

    const existingWithBadge = await db.student_wallets.where("badge_code").equals(badgeCode).first();
    if (existingWithBadge && existingWithBadge.id !== editingId) {
      setFormError(t("admin.students.errorBadgeTaken"));
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const wallet: StudentWallet = {
        id: editingId ?? crypto.randomUUID(),
        student_name: studentName,
        badge_code: badgeCode,
        balance,
        email: form.email.trim(),
      };

      await db.student_wallets.put(wallet);
      await enqueueMutation(editingId ? "UPDATE" : "INSERT", "student_wallets", { ...wallet });
      void triggerManualSync();

      setView("list");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await db.student_wallets.delete(id);
    await enqueueMutation("DELETE", "student_wallets", { id });
    void triggerManualSync();
    setConfirmingDeleteId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {view === "list" ? t("admin.students.title") : editingId ? t("admin.students.editTitle") : t("admin.students.addTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            ✕
          </button>
        </div>

        {view === "list" ? (
          <>
            <button
              type="button"
              onClick={openCreateForm}
              className="mb-4 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground"
            >
              {t("admin.students.add")}
            </button>

            <div className="flex-1 overflow-y-auto">
              {wallets === undefined ? (
                <p className="text-sm text-muted">{t("admin.students.loading")}</p>
              ) : wallets.length === 0 ? (
                <p className="text-sm text-muted">{t("admin.students.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {wallets.map((wallet) => (
                    <li
                      key={wallet.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{wallet.student_name}</p>
                        <p className="text-xs text-muted">
                          {wallet.badge_code} · {formatCurrency(wallet.balance)}
                        </p>
                      </div>

                      {confirmingDeleteId === wallet.id ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDelete(wallet.id)}
                            className="rounded-lg bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground"
                          >
                            {t("admin.students.confirmDelete")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground"
                          >
                            {t("admin.students.cancelDelete")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(wallet)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                          >
                            {t("admin.students.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(wallet.id)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:border-destructive"
                          >
                            {t("admin.students.delete")}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
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
                    min="0"
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

              {formError && <p className="text-xs text-destructive">{formError}</p>}

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  disabled={saving}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground disabled:opacity-50"
                >
                  {t("admin.students.formCancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                >
                  {t("admin.students.formSave")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
