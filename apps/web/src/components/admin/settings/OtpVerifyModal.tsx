import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ButtonCustom } from "@/components/ui/button-custom";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

interface OtpVerifyModalProps {
  email: string;
  title: string;
  onVerified: () => void;
  onClose: () => void;
}

// Gates a sensitive account change (PIN/password) behind a one-time code
// mailed to the admin's own account address -- shouldCreateUser: false
// means this can only ever send a code to an email that's already a real
// account, never silently provision one. Re-verifying via email OTP issues
// a fresh session for the same user (harmless -- App.tsx's onAuthStateChange
// just updates `session` to the same signed-in user, no remount), it's not
// treated as a competing "real" login anywhere in this app.
export function OtpVerifyModal({ email, title, onVerified, onClose }: OtpVerifyModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentOnceRef = useRef(false);

  const sendCode = async () => {
    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    setSending(false);
    if (sendError) {
      console.warn("[OtpVerifyModal] signInWithOtp failed", sendError);
      setError(t("admin.profile.otp.sendError"));
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  useEffect(() => {
    if (sentOnceRef.current) return;
    sentOnceRef.current = true;
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [cooldown]);

  const handleVerify = async () => {
    if (code.length !== OTP_LENGTH || verifying) return;
    setVerifying(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setVerifying(false);
    if (verifyError) {
      console.warn("[OtpVerifyModal] verifyOtp failed", verifyError);
      setError(t("admin.profile.otp.invalidCode"));
      setCode("");
      return;
    }
    onVerified();
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

        <p className="mb-3 text-sm text-muted">{t("admin.profile.otp.sentTo", { email })}</p>

        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
          placeholder={t("admin.profile.otp.placeholder")}
          className="mb-3 w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-center text-lg tracking-[0.3em] text-foreground outline-none focus:ring-2 focus:ring-accent"
        />

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        <div className="flex flex-col gap-2">
          <ButtonCustom
            variant="primary"
            isLoading={verifying}
            disabled={code.length !== OTP_LENGTH}
            onClick={() => void handleVerify()}
          >
            {t("admin.profile.otp.verify")}
          </ButtonCustom>
          <button
            type="button"
            disabled={cooldown > 0 || sending}
            onClick={() => void sendCode()}
            className="text-xs text-muted hover:text-foreground disabled:opacity-50"
          >
            {cooldown > 0 ? t("admin.profile.otp.resendCooldown", { count: cooldown }) : t("admin.profile.otp.resend")}
          </button>
        </div>
      </div>
    </div>
  );
}
