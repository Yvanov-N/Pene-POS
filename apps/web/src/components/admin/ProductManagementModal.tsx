import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { formatCurrency } from "@/lib/currency";
import { CardCustom } from "@/components/ui/card-custom";
import type { Product } from "@/types/db";

type View = "list" | "form";

interface FormState {
  name: string;
  price: string;
  stock: string;
  category: string;
  barcode: string;
  emoji: string;
  expiry_date: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  price: "",
  stock: "",
  category: "",
  barcode: "",
  emoji: "",
  expiry_date: "",
};

function productToForm(product: Product): FormState {
  return {
    name: product.name,
    price: String(product.price),
    stock: String(product.stock),
    category: product.category ?? "",
    barcode: product.barcode ?? "",
    emoji: product.emoji ?? "",
    expiry_date: product.expiry_date?.slice(0, 10) ?? "",
  };
}

export function ProductManagementModal() {
  const { t } = useTranslation();
  const { triggerManualSync } = useSyncEngine();
  // "name" isn't part of the Dexie schema's index list (id, barcode,
  // category, expiry_date, updated_at only) -- orderBy("name") throws at
  // runtime, so sort in memory instead of adding a schema migration for it.
  const products = useLiveQuery(
    () => db.products.toArray().then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name))),
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

  const openEditForm = (product: Product) => {
    setEditingId(product.id);
    setForm(productToForm(product));
    setFormError(null);
    setView("form");
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const price = Number(form.price);
    const stock = Number(form.stock);

    if (!name) {
      setFormError(t("admin.products.errorNameRequired"));
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError(t("admin.products.errorPriceInvalid"));
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setFormError(t("admin.products.errorStockInvalid"));
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const product: Product = {
        id: editingId ?? crypto.randomUUID(),
        name,
        price,
        stock,
        category: form.category.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        emoji: form.emoji.trim() || undefined,
        expiry_date: form.expiry_date ? new Date(form.expiry_date).toISOString() : undefined,
        updated_at: new Date().toISOString(),
      };

      await db.products.put(product);
      await enqueueMutation(editingId ? "UPDATE" : "INSERT", "products", { ...product });
      void triggerManualSync();

      setView("list");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await db.products.delete(id);
    await enqueueMutation("DELETE", "products", { id });
    void triggerManualSync();
    setConfirmingDeleteId(null);
  };

  return (
    <CardCustom
      className="mx-auto max-w-lg"
      title={
        view === "list" ? t("admin.products.title") : editingId ? t("admin.products.editTitle") : t("admin.products.addTitle")
      }
    >

        {view === "list" ? (
          <>
            <button
              type="button"
              onClick={openCreateForm}
              className="mb-4 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground"
            >
              {t("admin.products.add")}
            </button>

            <div className="flex-1 overflow-y-auto">
              {products === undefined ? (
                <p className="text-sm text-muted">{t("admin.products.loading")}</p>
              ) : products.length === 0 ? (
                <p className="text-sm text-muted">{t("admin.products.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {products.map((product) => (
                    <li
                      key={product.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden className="text-xl">
                          {product.emoji ?? "📦"}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
                          <p className="text-xs text-muted">
                            {formatCurrency(product.price)} · {t("pos.grid.stockLabel", { count: product.stock })}
                          </p>
                        </div>
                      </div>

                      {confirmingDeleteId === product.id ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDelete(product.id)}
                            className="rounded-lg bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground"
                          >
                            {t("admin.products.confirmDelete")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground"
                          >
                            {t("admin.products.cancelDelete")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(product)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                          >
                            {t("admin.products.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(product.id)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:border-destructive"
                          >
                            {t("admin.products.delete")}
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
                <span className="text-muted">{t("admin.products.fieldName")}</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>

              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.products.fieldPrice")}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.products.fieldStock")}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                </label>
              </div>

              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.products.fieldCategory")}</span>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                  />
                </label>
                <label className="flex w-20 flex-col gap-1 text-sm">
                  <span className="text-muted">{t("admin.products.fieldEmoji")}</span>
                  <input
                    type="text"
                    value={form.emoji}
                    onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                    className="rounded-lg border border-border bg-surface2 px-3 py-2 text-center text-foreground"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.products.fieldBarcode")}</span>
                <input
                  type="text"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{t("admin.products.fieldExpiry")}</span>
                <input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
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
                  {t("admin.products.formCancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                >
                  {t("admin.products.formSave")}
                </button>
              </div>
            </div>
          </div>
        )}
    </CardCustom>
  );
}
