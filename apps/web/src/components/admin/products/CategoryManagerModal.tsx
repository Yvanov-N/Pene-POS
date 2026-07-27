import { useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { db } from "@/lib/db";
import { commitLocal, makeOutboxEntry, recordOutbox } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { notTakenByOther } from "@/lib/validation";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import type { Category } from "@/types/db";

interface CategoryManagerModalProps {
  onClose: () => void;
}

interface CategoryFormValues {
  name: string;
}

export function CategoryManagerModal({ onClose }: CategoryManagerModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const categories = useLiveQuery(() => db.categories.orderBy("name").toArray(), []);
  const productCounts = useLiveQuery(async () => {
    const products = await db.products.toArray();
    const counts = new Map<string, number>();
    for (const product of products) {
      if (!product.category_id) continue;
      counts.set(product.category_id, (counts.get(product.category_id) ?? 0) + 1);
    }
    return counts;
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);

  const addFormik = useFormik<CategoryFormValues>({
    initialValues: { name: "" },
    validateOnChange: false,
    validateOnBlur: true,
    validationSchema: Yup.object({
      name: Yup.string()
        .trim()
        .required(t("admin.categories.errorNameRequired"))
        .test("unique-category-name", t("admin.categories.errorNameDuplicate"), async (value) => {
          const trimmed = value?.trim();
          if (!trimmed) return true;
          const existing = await db.categories.where("name").equals(trimmed).first();
          return notTakenByOther(existing, undefined);
        }),
    }),
    onSubmit: async (values, helpers) => {
      const name = values.name.trim();
      const category: Category = { id: crypto.randomUUID(), name, updated_at: new Date().toISOString() };
      const entry = makeOutboxEntry("generic_insert", "categories", { ...category });
      await commitLocal(db.categories, () => db.categories.put(category), entry);
      void pushOutbox(entry);

      showToast("success", t("admin.categories.addSuccessToast", { name }));
      helpers.resetForm();
    },
  });

  const editFormik = useFormik<CategoryFormValues>({
    initialValues: { name: "" },
    validateOnChange: false,
    validateOnBlur: true,
    validationSchema: Yup.object({
      name: Yup.string()
        .trim()
        .required(t("admin.categories.errorNameRequired"))
        .test("unique-category-name", t("admin.categories.errorNameDuplicate"), async (value) => {
          const trimmed = value?.trim();
          if (!trimmed) return true;
          const existing = await db.categories.where("name").equals(trimmed).first();
          return notTakenByOther(existing, editingId ?? undefined);
        }),
    }),
    onSubmit: async (values) => {
      const category = categories?.find((c) => c.id === editingId);
      if (!category) return;

      const name = values.name.trim();
      const updated: Category = { ...category, name, updated_at: new Date().toISOString() };
      const entry = makeOutboxEntry("generic_update", "categories", { ...updated });
      await commitLocal(db.categories, () => db.categories.put(updated), entry);
      void pushOutbox(entry);

      showToast("success", t("admin.categories.renameSuccessToast", { name }));
      setEditingId(null);
    },
  });

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    editFormik.resetForm({ values: { name: category.name } });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleDelete = async (category: Category) => {
    const affectedProducts = await db.products.where("category_id").equals(category.id).toArray();

    const productEntries = affectedProducts.map((product) =>
      // Explicit null (not undefined) -- the payload is JSON-serialized for
      // the Supabase push, and an undefined key is dropped rather than
      // clearing the column server-side.
      makeOutboxEntry("generic_update", "products", { id: product.id, category_id: null }),
    );
    const categoryEntry = makeOutboxEntry("generic_delete", "categories", { id: category.id });

    await db.transaction("rw", db.products, db.categories, db.sync_outbox, async () => {
      for (let i = 0; i < affectedProducts.length; i += 1) {
        const product = affectedProducts[i];
        await db.products.put({ ...product, category_id: undefined });
        await recordOutbox(productEntries[i]);
      }
      await db.categories.delete(category.id);
      await recordOutbox(categoryEntry);
    });

    void Promise.all([...productEntries.map((e) => pushOutbox(e)), pushOutbox(categoryEntry)]);
    showToast(
      "success",
      affectedProducts.length > 0
        ? t("admin.categories.deleteSuccessReassigned", { count: affectedProducts.length })
        : t("admin.categories.deleteSuccessToast"),
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t("admin.categories.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              name="name"
              value={addFormik.values.name}
              onChange={addFormik.handleChange}
              onBlur={addFormik.handleBlur}
              placeholder={t("admin.categories.addPlaceholder")}
              className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
            />
            <ButtonCustom
              variant="primary"
              size="sm"
              isLoading={addFormik.isSubmitting}
              onClick={() => void addFormik.submitForm()}
            >
              {t("admin.categories.add")}
            </ButtonCustom>
          </div>
          <FieldError touched={addFormik.touched.name} error={addFormik.errors.name} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {categories === undefined ? (
            <p className="text-sm text-muted">{t("admin.categories.loading")}</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.categories.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {categories.map((category) => {
                const isEditing = editingId === category.id;
                const count = productCounts?.get(category.id) ?? 0;

                return (
                  <li key={category.id} className="rounded-lg border border-border p-3">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          name="name"
                          value={editFormik.values.name}
                          onChange={editFormik.handleChange}
                          onBlur={editFormik.handleBlur}
                          className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
                        />
                        <FieldError touched={editFormik.touched.name} error={editFormik.errors.name} />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={editFormik.isSubmitting}
                            className="flex-1 rounded-lg border border-border py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
                          >
                            {t("admin.categories.cancel")}
                          </button>
                          <ButtonCustom
                            variant="primary"
                            size="sm"
                            className="flex-1"
                            isLoading={editFormik.isSubmitting}
                            onClick={() => void editFormik.submitForm()}
                          >
                            {t("admin.categories.save")}
                          </ButtonCustom>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{category.name}</p>
                          <p className="text-xs text-muted">{t("admin.categories.productCount", { count })}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(category)}
                            className="rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                          >
                            {t("admin.categories.edit")}
                          </button>
                          <ButtonCustom
                            variant="danger"
                            size="sm"
                            requiresAdminPin
                            pinModalTitle={t("admin.categories.deletePinTitle")}
                            onClick={() => void handleDelete(category)}
                          >
                            {t("admin.categories.delete")}
                          </ButtonCustom>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
