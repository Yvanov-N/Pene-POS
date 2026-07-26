import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";

const PIN_LENGTH = 4;
const PIN_PATTERN = /^\d{4}$/;
// Gives the magic-link redirect's own session-parsing a brief moment to
// land before concluding the link was invalid/expired -- see the effect
// below, which never downgrades an already-confirmed session back to this.
const SESSION_CHECK_GRACE_MS = 1500;
const REDIRECT_DELAY_MS = 1500;

type Status = "checking" | "ready" | "invalid";

// Reached via the "Forgot PIN?" link on PinPadModal, which sends a
// signInWithOtp magic link redirecting here -- mirrors ResetPasswordForm.tsx
// (same two-PIN-fields shape as ProfileSettingsCard's own PIN change) but for
// profiles.pin_code/pin_hash instead of the Supabase Auth password.
export function ResetPinForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!PIN_PATTERN.test(newPin)) {
      setError(t("resetPin.invalid"));
      return;
    }
    if (newPin !== confirmPin) {
      setError(t("resetPin.mismatch"));
      return;
    }

    setSaving(true);

    // Server first, same ordering as ProfileSettingsCard's applyPinChange --
    // if the RPC fails, this device's local cache must not be written either.
    const { error: rpcError } = await supabase.rpc("update_own_pin_code", { new_pin: newPin });
    if (rpcError) {
      console.warn("[ResetPinForm] update_own_pin_code failed", rpcError);
      setSaving(false);
      setError(t("resetPin.error"));
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      await db.profiles.update(userData.user.id, { pin_hash: await hashPin(newPin) });
    }

    // The magic link signs this browser in as the profile's own Supabase Auth
    // account -- if this happens to be the shared POS terminal rather than
    // the user's own phone, leaving that session active would silently swap
    // which account the whole terminal is signed in as. Signing out forces a
    // normal re-login instead, and is harmless if this was a personal device.
    await supabase.auth.signOut();

    setSaving(false);
    setDone(true);
    window.setTimeout(() => navigate("/", { replace: true }), REDIRECT_DELAY_MS);
  };

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
            <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
              <input
                type="password"
                inputMode="numeric"
                required
                value={newPin}
                onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                placeholder={t("resetPin.newPinPlaceholder")}
                className="rounded-lg border border-border bg-surface2 px-4 py-2 text-center tracking-[0.3em] text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="password"
                inputMode="numeric"
                required
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                placeholder={t("resetPin.confirmPinPlaceholder")}
                className="rounded-lg border border-border bg-surface2 px-4 py-2 text-center tracking-[0.3em] text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={saving}
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
