import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";

type Mode = "login" | "forgot";

// supabase-js names this specific error for a fetch/network-level failure
// (server unreachable) -- distinct from a real 4xx response like wrong
// credentials, which the generic "auth.error" message covers.
function isNetworkError(error: { name?: string } | null): boolean {
  return error?.name === "AuthRetryableFetchError";
}

export function GlobalLogin() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (signInError) {
      setError(isNetworkError(signInError) ? t("auth.networkError") : t("auth.error"));
    }
    // On success, App's onAuthStateChange listener transitions to PosLayout.
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    await supabase.auth.signInWithOAuth({ provider });
  };

  const handleForgotPassword = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    setLoading(false);
    if (resetError) {
      setError(isNetworkError(resetError) ? t("auth.networkError") : t("auth.resetError"));
      return;
    }
    setResetEmailSent(true);
  };

  const backToLogin = () => {
    setMode("login");
    setError(null);
    setResetEmailSent(false);
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-3xl overflow-hidden rounded-xl border border-border">
        <div className="hidden w-1/2 flex-col justify-between bg-accent p-8 text-accent-foreground sm:flex">
          <span className="text-lg font-semibold">Pene POS</span>
          <div>
            <p className="text-2xl font-semibold">{t("auth.tagline")}</p>
            <p className="mt-2 text-sm opacity-80">{t("auth.subtitle")}</p>
          </div>
          <span className="text-4xl" aria-hidden>
            🛒
          </span>
        </div>

        <div className="flex w-full flex-col justify-center gap-4 bg-surface p-8 sm:w-1/2">
          {mode === "login" ? (
            <>
              <h1 className="text-xl font-semibold text-foreground">{t("auth.title")}</h1>

              <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                  className="rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                  className="rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                />

                {error && <p className="text-xs text-destructive">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                >
                  {t("auth.submit")}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                  }}
                  className="text-xs text-muted hover:text-foreground"
                >
                  {t("auth.forgotPassword")}
                </button>
              </form>

              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="h-px flex-1 bg-border" />
                {t("auth.orContinueWith")}
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void handleOAuth("google")}
                  className="rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground hover:border-accent"
                >
                  {t("auth.google")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleOAuth("apple")}
                  className="rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground hover:border-accent"
                >
                  {t("auth.apple")}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-foreground">{t("auth.forgotPasswordTitle")}</h1>
              <p className="text-sm text-muted">{t("auth.forgotPasswordSubtitle")}</p>

              {resetEmailSent ? (
                <p className="text-sm text-foreground">{t("auth.resetEmailSent")}</p>
              ) : (
                <form className="flex flex-col gap-3" onSubmit={handleForgotPassword}>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("auth.emailPlaceholder")}
                    className="rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                  />

                  {error && <p className="text-xs text-destructive">{error}</p>}

                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                  >
                    {t("auth.sendResetLink")}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={backToLogin}
                className="text-xs text-muted hover:text-foreground"
              >
                {t("auth.backToLogin")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
