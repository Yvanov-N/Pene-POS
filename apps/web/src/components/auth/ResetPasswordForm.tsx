import { useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { passwordSchema, passwordConfirmationSchema } from "@/lib/validation";
import { FieldError } from "@/components/ui/field-error";

interface ResetPasswordFormProps {
  onComplete: () => void;
}

interface FormValues {
  password: string;
  confirmPassword: string;
}

export function ResetPasswordForm({ onComplete }: ResetPasswordFormProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);

  const formik = useFormik<FormValues>({
    initialValues: { password: "", confirmPassword: "" },
    validationSchema: Yup.object({
      password: passwordSchema(t("auth.passwordTooShort")),
      confirmPassword: passwordConfirmationSchema("password", t("auth.passwordMismatch")),
    }),
    onSubmit: async (values) => {
      setError(null);
      const { error: updateError } = await supabase.auth.updateUser({ password: values.password });
      if (updateError) {
        setError(t("auth.resetError"));
        return;
      }
      setUpdated(true);
      window.setTimeout(onComplete, 1200);
    },
  });

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <h1 className="mb-4 text-xl font-semibold text-foreground">{t("auth.newPasswordTitle")}</h1>

        {updated ? (
          <p className="text-sm text-foreground">{t("auth.passwordUpdated")}</p>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={formik.handleSubmit}>
            <div>
              <input
                type="password"
                name="password"
                value={formik.values.password}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t("auth.newPasswordPlaceholder")}
                className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <FieldError touched={formik.touched.password} error={formik.errors.password} />
            </div>
            <div>
              <input
                type="password"
                name="confirmPassword"
                value={formik.values.confirmPassword}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t("auth.confirmPasswordPlaceholder")}
                className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <FieldError touched={formik.touched.confirmPassword} error={formik.errors.confirmPassword} />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={formik.isSubmitting}
              className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {t("auth.updatePassword")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
