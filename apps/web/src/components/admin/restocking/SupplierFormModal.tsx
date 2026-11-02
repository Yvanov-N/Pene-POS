import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { db } from "@/lib/db";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useToast } from "@/hooks/useToast";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import type { Supplier } from "@/types/db";
import { INPUT_CLASS } from "./styles";

interface SupplierFormValues {
  name: string;
  contact_name: string;
  phone: string;
  location: string;
  notes: string;
}

interface SupplierFormModalProps {
  // Edit mode when set, create mode otherwise.
  supplier?: Supplier;
  onClose: () => void;
  onSaved?: (supplier: Supplier) => void;
}

// Optional text columns go to the server as null, not "" -- an empty string
// would otherwise read as a real (blank) phone number or location.
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function SupplierFormModal({ supplier, onClose, onSaved }: SupplierFormModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const formik = useFormik<SupplierFormValues>({
    initialValues: {
      name: supplier?.name ?? "",
      contact_name: supplier?.contact_name ?? "",
      phone: supplier?.phone ?? "",
      location: supplier?.location ?? "",
      notes: supplier?.notes ?? "",
    },
    validationSchema: Yup.object({
      name: Yup.string().trim().required(t("suppliers.errorNameRequired")),
      phone: Yup.string()
        .trim()
        .matches(/^[+\d][\d\s.-]{5,}$/, { message: t("suppliers.errorPhoneInvalid"), excludeEmptyString: true }),
    }),
    onSubmit: async (values) => {
      const now = new Date().toISOString();
      const fields = {
        name: values.name.trim(),
        contact_name: orNull(values.contact_name),
        phone: orNull(values.phone),
        location: orNull(values.location),
        notes: orNull(values.notes),
      };
      const saved: Supplier = {
        ...supplier,
        id: supplier?.id ?? crypto.randomUUID(),
        created_at: supplier?.created_at ?? now,
        updated_at: now,
        name: fields.name,
        contact_name: fields.contact_name ?? undefined,
        phone: fields.phone ?? undefined,
        location: fields.location ?? undefined,
        notes: fields.notes ?? undefined,
      };
      const entry = supplier
        ? makeOutboxEntry("generic_update", "suppliers", { id: saved.id, ...fields })
        : makeOutboxEntry("generic_insert", "suppliers", { id: saved.id, created_at: now, ...fields });
      await commitLocal(db.suppliers, () => db.suppliers.put(saved), entry);
      void pushOutbox(entry);

      showToast("success", t(supplier ? "suppliers.updateSuccessToast" : "suppliers.createSuccessToast", { name: saved.name }));
      onSaved?.(saved);
      onClose();
    },
  });

  const field = (name: keyof SupplierFormValues, label: string, type = "text") => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type={type}
        name={name}
        value={formik.values[name]}
        onChange={formik.handleChange}
        onBlur={formik.handleBlur}
        className={INPUT_CLASS}
      />
      <FieldError touched={formik.touched[name]} error={formik.errors[name]} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {supplier ? t("suppliers.editTitle") : t("suppliers.createTitle")}
          </h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground" aria-label={t("pos.pin.close")}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={formik.handleSubmit}>
          {field("name", t("suppliers.nameLabel"))}
          {field("contact_name", t("suppliers.contactLabel"))}
          {field("phone", t("suppliers.phoneLabel"), "tel")}
          {field("location", t("suppliers.locationLabel"))}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("suppliers.notesLabel")}</span>
            <textarea
              name="notes"
              rows={2}
              value={formik.values.notes}
              onChange={formik.handleChange}
              className={INPUT_CLASS}
            />
          </label>

          <ButtonCustom variant="primary" isLoading={formik.isSubmitting} onClick={() => void formik.submitForm()}>
            {t("suppliers.save")}
          </ButtonCustom>
        </form>
      </div>
    </div>
  );
}
