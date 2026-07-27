import { useEffect, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";
import { supabase } from "@/lib/supabase";
import { FieldError } from "@/components/ui/field-error";
import type { Profile } from "@/types/db";
import type { UserRole } from "@/types/supabase";

const PIN_LENGTH = 4;
const SHAKE_DURATION_MS = 400;
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
const FAILED_ATTEMPTS_BEFORE_RESET = 3;

// Same "don't reveal account existence" concern as GlobalLogin's own
// isNetworkError -- signInWithOtp({ shouldCreateUser: false }) errors for an
// address with no matching account, so only a genuine network failure gets
// its own message below; anything else is treated the same as success.
function isNetworkError(error: { name?: string } | null): boolean {
  return error?.name === "AuthRetryableFetchError";
}

type PinPadView = "pad" | "forgot" | "sent";

interface ForgotFormValues {
  resetEmail: string;
}

interface PinPadModalProps {
  title: string;
  onSuccess: (profile: Profile) => void;
  onClose: () => void;
  // When set, only a profile with this exact role can match -- a correct
  // PIN belonging to a profile of the wrong role is treated the same as an
  // incorrect PIN (never reveal "valid PIN, wrong role").
  requiredRole?: UserRole;
}

export function PinPadModal({ title, onSuccess, onClose, requiredRole }: PinPadModalProps) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState("");
  const [shake, setShake] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const [view, setView] = useState<PinPadView>("pad");
  const [resetError, setResetError] = useState<string | null>(null);

  const forgotFormik = useFormik<ForgotFormValues>({
    initialValues: { resetEmail: "" },
    validationSchema: Yup.object({
      resetEmail: Yup.string()
        .trim()
        .required(t("pos.pin.forgotEmailRequired"))
        .email(t("pos.pin.forgotEmailInvalid")),
    }),
    onSubmit: async (values) => {
      setResetError(null);
      const { error } = await supabase.auth.signInWithOtp({
        email: values.resetEmail,
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/reset-pin` },
      });

      if (error && isNetworkError(error)) {
        setResetError(t("pos.pin.forgotNetworkError"));
        return;
      }
      setView("sent");
    },
  });

  const verify = async (candidate: string) => {
    setChecking(true);
    const allowedRoles = requiredRole ? [requiredRole] : (["admin", "cashier"] as const);
    const candidates = await db.profiles.where("role").anyOf(allowedRoles).toArray();
    const candidateHash = await hashPin(candidate);
    const match = candidates.find((profile) => profile.pin_hash === candidateHash);
    setChecking(false);

    if (match) {
      setErrorMessage(null);
      setFailedAttempts(0);
      onSuccess(match);
      return;
    }

    setErrorMessage(t("pos.pin.incorrect"));
    setFailedAttempts((current) => current + 1);
    setShake(true);
    setDigits("");
    window.setTimeout(() => setShake(false), SHAKE_DURATION_MS);
  };

  const handleKeyPress = (key: string) => {
    if (checking) return;

    if (key === "back") {
      setDigits((current) => current.slice(0, -1));
      return;
    }
    if (key === "" || digits.length >= PIN_LENGTH) return;

    const next = digits + key;
    setDigits(next);
    if (next.length === PIN_LENGTH) {
      void verify(next);
    }
  };

  // Physical keyboard support -- only while the numeric pad itself is showing
  // (not the forgot-PIN email view, which has its own text input and needs
  // digits/Backspace to behave like normal typing instead of feeding the
  // pad). Re-attached on every digits/checking change rather than memoizing
  // handleKeyPress, so the listener never closes over a stale value.
  useEffect(() => {
    if (view !== "pad") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key >= "0" && event.key <= "9") {
        handleKeyPress(event.key);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        handleKeyPress("back");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [view, digits, checking]);

  const openForgotPin = () => {
    forgotFormik.resetForm();
    setResetError(null);
    setView("forgot");
  };

  const backToPad = () => {
    setView("pad");
    setErrorMessage(null);
    setFailedAttempts(0);
    setDigits("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {view === "pad" && (
          <>
            <div className={`pin-dots mb-2 ${shake ? "shake" : ""}`}>
              {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                <span key={index} className={`pin-dot ${index < digits.length ? "filled" : ""}`} />
              ))}
            </div>

            <p className="mb-1 h-4 text-center text-xs text-destructive">{errorMessage}</p>

            {failedAttempts >= FAILED_ATTEMPTS_BEFORE_RESET && (
              <p className="mb-3 text-center">
                <button type="button" onClick={openForgotPin} className="text-xs text-muted underline hover:text-foreground">
                  {t("pos.pin.forgotPin")}
                </button>
              </p>
            )}

            <div className="pin-pad">
              {PAD_KEYS.map((key, index) => {
                if (key === "") return <span key={`blank-${index}`} />;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleKeyPress(key)}
                    disabled={checking}
                    className="rounded-lg border border-border bg-surface2 py-3 text-lg font-medium text-foreground transition-colors hover:border-accent disabled:opacity-50"
                  >
                    {key === "back" ? "⌫" : key}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {view === "forgot" && (
          <form className="flex flex-col gap-3" onSubmit={forgotFormik.handleSubmit}>
            <p className="text-xs text-muted">{t("pos.pin.forgotSubtitle")}</p>
            <div>
              <input
                type="email"
                name="resetEmail"
                value={forgotFormik.values.resetEmail}
                onChange={forgotFormik.handleChange}
                onBlur={forgotFormik.handleBlur}
                placeholder={t("auth.emailPlaceholder")}
                className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <FieldError touched={forgotFormik.touched.resetEmail} error={forgotFormik.errors.resetEmail} />
            </div>

            {resetError && <p className="text-xs text-destructive">{resetError}</p>}

            <button
              type="submit"
              disabled={forgotFormik.isSubmitting}
              className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {t("pos.pin.sendResetLink")}
            </button>
            <button type="button" onClick={backToPad} className="text-xs text-muted hover:text-foreground">
              {t("pos.pin.backToPad")}
            </button>
          </form>
        )}

        {view === "sent" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">{t("pos.pin.resetEmailSent")}</p>
            <button type="button" onClick={backToPad} className="text-xs text-muted hover:text-foreground">
              {t("pos.pin.backToPad")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
