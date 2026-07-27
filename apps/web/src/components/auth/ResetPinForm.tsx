import { useEffect, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";
import { PIN_LENGTH, pinSchema, pinConfirmationSchema } from "@/lib/validation";
import { FieldError } from "@/components/ui/field-error";

// Gives the magic-link redirect's own session-parsing a brief moment to
// land before concluding the link was invalid/expired -- see the effect
// below, which never downgrades an already-confirmed session back to this.
const SESSION_CHECK_GRACE_MS = 1500;
const REDIRECT_DELAY_MS = 1500;

type Status = "checking" | "ready" | "invalid";

interface FormValues {
  newPin: string;
  confirmPin: string;
}

// Reached via the "Forgot PIN?" link on PinPadModal, which sends a
// signInWithOtp magic link redirecting here -- mirrors ResetPasswordForm.tsx
// (same two-PIN-fields shape as ProfileSettingsCard's own PIN change) but for
// profiles.pin_code/pin_hash instead of the Supabase Auth password.
export function ResetPinForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setStatus("ready");
    });

    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setStatus("ready");
        return;
      }
      window.setTimeout(() => {
        setStatus((current) => (current === "checking" ? "invalid" : current));
      }, SESSION_CHECK_GRACE_MS);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const formik = useFormik<FormValues>({
    initialValues: { newPin: "", confirmPin: "" },
    validationSchema: Yup.object({
      newPin: pinSchema(t("resetPin.invalid")),
      confirmPin: pinConfirmationSchema("newPin", t("resetPin.mismatch")),
    }),
    onSubmit: async (values) => {
      setError(null);

      // Server first, same ordering as ProfileSettingsCard's applyPinChange --
      // if the RPC fails, this device's local cache must not be written either.
      const { error: rpcError } = await supabase.rpc("update_own_pin_code", { new_pin: values.newPin });
      if (rpcError) {
        console.warn("[ResetPinForm] update_own_pin_code failed", rpcError);
        setError(t("resetPin.error"));
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await db.profiles.update(userData.user.id, { pin_hash: await hashPin(values.newPin) });
      }

      // The magic link signs this browser in as the profile's own Supabase Auth
      // account -- if this happens to be the shared POS terminal rather than
      // the user's own phone, leaving that session active would silently swap
      // which account the whole terminal is signed in as. Signing out forces a
      // normal re-login instead, and is harmless if this was a personal device.
      await supabase.auth.signOut();

      setDone(true);
      window.setTimeout(() => navigate("/", { replace: true }), REDIRECT_DELAY_MS);
    },
  });

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <h1 className="mb-4 text-xl font-semibold text-foreground">{t("resetPin.title")}</h1>

        {status === "checking" && <p className="text-sm text-muted">{t("resetPin.checkingLink")}</p>}

        {status === "invalid" && <p className="text-sm text-destructive">{t("resetPin.invalidLink")}</p>}

        {status === "ready" &&
          (done ? (
            <p className="text-sm text-foreground">{t("resetPin.updated")}</p>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={formik.handleSubmit}>
              <div>
                <input
                  type="password"
                  inputMode="numeric"
                  name="newPin"
                  value={formik.values.newPin}
                  onChange={(event) =>
                    formik.setFieldValue("newPin", event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))
                  }
                  onBlur={formik.handleBlur}
                  placeholder={t("resetPin.newPinPlaceholder")}
                  className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-center tracking-[0.3em] text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                />
                <FieldError touched={formik.touched.newPin} error={formik.errors.newPin} />
              </div>
              <div>
                <input
                  type="password"
                  inputMode="numeric"
                  name="confirmPin"
                  value={formik.values.confirmPin}
                  onChange={(event) =>
                    formik.setFieldValue("confirmPin", event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))
                  }
                  onBlur={formik.handleBlur}
                  placeholder={t("resetPin.confirmPinPlaceholder")}
                  className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-center tracking-[0.3em] text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                />
                <FieldError touched={formik.touched.confirmPin} error={formik.errors.confirmPin} />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={formik.isSubmitting}
                className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                {t("resetPin.submit")}
              </button>
            </form>
          ))}
      </div>
    </div>
  );
}
