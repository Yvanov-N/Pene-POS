import { useEffect, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { FieldError } from "@/components/ui/field-error";
import logo from "@/assets/logo.png";
import cashierPhoto from "@/assets/cashier.jpg";

type Mode = "login" | "forgot";
type OAuthProvider = "google" | "apple";
const OAUTH_PROVIDERS: OAuthProvider[] = ["google", "apple"];

interface FormValues {
  email: string;
  password: string;
}

// supabase-js names this specific error for a fetch/network-level failure
// (server unreachable) -- distinct from a real 4xx response like wrong
// credentials, which the generic "auth.error" message covers.
function isNetworkError(error: { name?: string } | null): boolean {
  return error?.name === "AuthRetryableFetchError";
}

export function GlobalLogin() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  // A provider only ever shows up here once at least one account has
  // actually linked it (see admin.profile.oauth.* in ProfileSettingsCard) --
  // a fresh deployment's Supabase project may not even have Google/Apple
  // configured yet, and a login button that always 404s/errors is worse
  // than no button. oauth_provider_linked (migration 12) is a narrow
  // SECURITY DEFINER RPC anon can call for exactly this yes/no fact.
  const [oauthLinked, setOauthLinked] = useState<Record<OAuthProvider, boolean>>({
    google: false,
    apple: false,
  });

  useEffect(() => {
    for (const provider of OAUTH_PROVIDERS) {
      void supabase.rpc("oauth_provider_linked", { provider_name: provider }).then(({ data, error }) => {
        if (error) {
          console.warn(`[GlobalLogin] oauth_provider_linked(${provider}) failed`, error);
          return;
        }
        setOauthLinked((current) => ({ ...current, [provider]: data ?? false }));
      });
    }
  }, []);

  const showOauth = oauthLinked.google || oauthLinked.apple;

  // One shared formik instance across both modes -- not two -- so the email
  // the user already typed in "login" mode carries over verbatim if they
  // switch to "forgot" (matching the previous single `email` useState's
  // behavior). Only "login" mode requires a password.
  const formik = useFormik<FormValues>({
    initialValues: { email: "", password: "" },
    validationSchema: Yup.object({
      email: Yup.string().trim().required(t("auth.emailRequired")).email(t("auth.emailInvalid")),
      password: mode === "login" ? Yup.string().required(t("auth.passwordRequired")) : Yup.string().notRequired(),
    }),
    onSubmit: async (values) => {
      setError(null);
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        });
        if (signInError) {
          setError(isNetworkError(signInError) ? t("auth.networkError") : t("auth.error"));
        }
        // On success, App's onAuthStateChange listener transitions to PosLayout.
        return;
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: window.location.origin,
      });
      if (resetError) {
        setError(isNetworkError(resetError) ? t("auth.networkError") : t("auth.resetError"));
        return;
      }
      setResetEmailSent(true);
    },
  });

  const handleOAuth = async (provider: "google" | "apple") => {
    await supabase.auth.signInWithOAuth({ provider });
  };

  const backToLogin = () => {
    setMode("login");
    setError(null);
    setResetEmailSent(false);
    formik.setTouched({});
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-3xl overflow-hidden rounded-xl border border-border">
        <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-8 sm:flex">
          <img src={cashierPhoto} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/70" />
          <img
            src={logo}
            alt="Pene POS"
            className="relative z-10 h-9 object-contain w-auto drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
          />
          <div className="relative z-10 text-white">
            <p className="text-2xl font-semibold">{t("auth.tagline")}</p>
            <p className="mt-2 text-sm opacity-80">{t("auth.subtitle")}</p>
          </div>
        </div>

        <div className="flex w-full flex-col justify-center gap-4 bg-surface p-8 sm:w-1/2">
          {mode === "login" ? (
            <>
              <h1 className="text-xl font-semibold text-foreground">{t("auth.title")}</h1>

              <form className="flex flex-col gap-3" onSubmit={formik.handleSubmit}>
                <div>
                  <input
                    type="email"
                    name="email"
                    value={formik.values.email}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    placeholder={t("auth.emailPlaceholder")}
                    className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                  />
                  <FieldError touched={formik.touched.email} error={formik.errors.email} />
                </div>
                <div>
                  <input
                    type="password"
                    name="password"
                    value={formik.values.password}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    placeholder={t("auth.passwordPlaceholder")}
                    className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                  />
                  <FieldError touched={formik.touched.password} error={formik.errors.password} />
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <button
                  type="submit"
                  disabled={formik.isSubmitting}
                  className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                >
                  {t("auth.submit")}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    formik.setTouched({});
                  }}
                  className="text-xs text-muted hover:text-foreground"
                >
                  {t("auth.forgotPassword")}
                </button>
              </form>

              {showOauth && (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="h-px flex-1 bg-border" />
                    {t("auth.orContinueWith")}
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <div className="flex flex-col gap-2">
                    {oauthLinked.google && (
                      <button
                        type="button"
                        onClick={() => void handleOAuth("google")}
                        className="rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground hover:border-accent"
                      >
                        {t("auth.google")}
                      </button>
                    )}
                    {oauthLinked.apple && (
                      <button
                        type="button"
                        onClick={() => void handleOAuth("apple")}
                        className="rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground hover:border-accent"
                      >
                        {t("auth.apple")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-foreground">{t("auth.forgotPasswordTitle")}</h1>
              <p className="text-sm text-muted">{t("auth.forgotPasswordSubtitle")}</p>

              {resetEmailSent ? (
                <p className="text-sm text-foreground">{t("auth.resetEmailSent")}</p>
              ) : (
                <form className="flex flex-col gap-3" onSubmit={formik.handleSubmit}>
                  <div>
                    <input
                      type="email"
                      name="email"
                      value={formik.values.email}
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      placeholder={t("auth.emailPlaceholder")}
                      className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
                    />
                    <FieldError touched={formik.touched.email} error={formik.errors.email} />
                  </div>

                  {error && <p className="text-xs text-destructive">{error}</p>}

                  <button
                    type="submit"
                    disabled={formik.isSubmitting}
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
