import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Category } from "@/types/db";

interface CategoryManagerModalProps {
  onClose: () => void;
}

export function CategoryManagerModal({ onClose }: CategoryManagerModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

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

  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const savingEditRef = useRef(false);

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleAdd = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);

    try {
      const name = newName.trim();
      if (!name) {
        setAddError(t("admin.categories.errorNameRequired"));
        return;
      }
      const existing = await db.categories.where("name").equals(name).first();
      if (existing) {
        setAddError(t("admin.categories.errorNameDuplicate"));
        return;
      }

      setAddError(null);
      const category: Category = { id: crypto.randomUUID(), name, updated_at: new Date().toISOString() };
      await db.categories.put(category);
      await enqueueMutation("INSERT", "categories", { ...category });
      void triggerManualSync();

      showToast("success", t("admin.categories.addSuccessToast", { name }));
      setNewName("");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const handleSaveEdit = async (category: Category) => {
    if (savingEditRef.current) return;
    savingEditRef.current = true;
    setSavingEdit(true);

    try {
      const name = editName.trim();
      if (!name) {
        setEditError(t("admin.categories.errorNameRequired"));
        return;
      }
      const existing = await db.categories.where("name").equals(name).first();
      if (existing && existing.id !== category.id) {
        setEditError(t("admin.categories.errorNameDuplicate"));
        return;
      }

      setEditError(null);
      const updated: Category = { ...category, name, updated_at: new Date().toISOString() };
      await db.categories.put(updated);
      await enqueueMutation("UPDATE", "categories", { ...updated });
      void triggerManualSync();

      showToast("success", t("admin.categories.renameSuccessToast", { name }));
      setEditingId(null);
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  };

  const handleDelete = async (category: Category) => {
    const affectedProducts = await db.products.where("category_id").equals(category.id).toArray();

    await db.transaction("rw", db.products, db.categories, db.sync_queue, async () => {
      for (const product of affectedProducts) {
        await db.products.put({ ...product, category_id: undefined });
        // Explicit null (not undefined) -- the payload is JSON-serialized
        // for the Supabase push, and an undefined key is dropped rather
        // than clearing the column server-side.
        await enqueueMutation("UPDATE", "products", { id: product.id, category_id: null });
      }
      await db.categories.delete(category.id);
      await enqueueMutation("DELETE", "categories", { id: category.id });
    });

    void triggerManualSync();
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
            ✕
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("admin.categories.addPlaceholder")}
              className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
            />
            <ButtonCustom variant="primary" size="sm" isLoading={adding} onClick={() => void handleAdd()}>
              {t("admin.categories.add")}
            </ButtonCustom>
          </div>
          {addError && <p className="text-xs text-destructive">{addError}</p>}
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
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
                        />
                        {editError && <p className="text-xs text-destructive">{editError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                            className="flex-1 rounded-lg border border-border py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
                          >
                            {t("admin.categories.cancel")}
                          </button>
                          <ButtonCustom
                            variant="primary"
                            size="sm"
                            className="flex-1"
                            isLoading={savingEdit}
                            onClick={() => void handleSaveEdit(category)}
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
