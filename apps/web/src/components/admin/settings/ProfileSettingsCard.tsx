import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserIdentity } from "@supabase/supabase-js";
import { CircleUserRound } from "lucide-react";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useToast } from "@/hooks/useToast";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { AvatarEditModal } from "./AvatarEditModal";
import { computeFullName, type Profile } from "@/types/db";

type OAuthProvider = "google" | "apple";
const OAUTH_PROVIDERS: OAuthProvider[] = ["google", "apple"];

// Matches GoTrue's own default minimum -- checked client-side first so a
// too-short password fails fast instead of waiting on a round trip to
// discover the same rejection server-side.
const MIN_PASSWORD_LENGTH = 6;

interface FormState {
  first_name: string;
  last_name: string;
}

function profileToForm(profile: { first_name: string; last_name: string }): FormState {
  return {
    first_name: profile.first_name,
    last_name: profile.last_name,
  };
}

export function ProfileSettingsCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();
  const profile = useCurrentProfile();

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Same double-submit hazard as every other save handler in this app
  // (ProductFormDrawer's savingRef, StudentWalletsPage's savingRef) -- a ref
  // closes the race window a second useState-based invocation can't.
  const savingRef = useRef(false);

  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  // Account email/password act on the real Supabase Auth login, not a plain
  // profiles-table field -- kept entirely separate from the form/handleSave
  // above (different backend call, different confirmation semantics),
  // rather than folded into the same "Enregistrer" button.
  const [accountEmail, setAccountEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const emailSavingRef = useRef(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const passwordSavingRef = useRef(false);

  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !form) setForm(profileToForm(profile));
  }, [profile, form]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setAccountEmail(data.user.email);
    });
  }, []);

  useEffect(() => {
    void supabase.auth.getUserIdentities().then(({ data }) => setIdentities(data?.identities ?? []));
  }, []);

  const isLinked = (provider: OAuthProvider): boolean =>
    identities?.some((identity) => identity.provider === provider) ?? false;

  const handleSave = async () => {
    if (!profile || !form || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    try {
      const firstName = form.first_name.trim();
      const lastName = form.last_name.trim();

      if (!firstName) {
        setFormError(t("admin.profile.errorFirstNameRequired"));
        return;
      }
      setFormError(null);

      // full_name is a server-generated column (migration 00010) -- it's
      // computed here only for the optimistic local Dexie write, and
      // deliberately left OUT of the enqueued Supabase payload below
      // (Postgres rejects an UPDATE that references a generated column at
      // all, even with a matching value).
      await db.profiles.update(profile.id, {
        first_name: firstName,
        last_name: lastName,
        full_name: computeFullName(firstName, lastName),
      });
      await enqueueMutation("UPDATE", "profiles", {
        id: profile.id,
        first_name: firstName,
        last_name: lastName,
      });
      void triggerManualSync();

      showToast("success", t("admin.profile.saveSuccessToast"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // profile is only populated when requiresAdminPin actually gated this
  // click -- account email/password changes are sensitive enough to
  // re-confirm even inside an already-unlocked admin session, the same way
  // ShopStatusCard's toggle does.
  const handleUpdateEmail = async (adminProfile?: Profile) => {
    if (!adminProfile || emailSavingRef.current) return;
    emailSavingRef.current = true;
    setEmailSaving(true);

    try {
      const newEmail = accountEmail.trim();
      if (!newEmail) {
        setEmailError(t("admin.profile.errorEmailRequired"));
        return;
      }
      setEmailError(null);

      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) {
        console.warn("[ProfileSettingsCard] email update failed", error);
        setEmailError(t("admin.profile.emailUpdateError"));
        return;
      }

      // auth.users.email (and, via migration 00011's trigger,
      // profiles.email) only actually changes once the confirmation link
      // sent to the new address is clicked -- nothing to write locally yet.
      setEmailPending(true);
      showToast("success", t("admin.profile.emailUpdatePendingToast"));
    } finally {
      emailSavingRef.current = false;
      setEmailSaving(false);
    }
  };

  const handleUpdatePassword = async (adminProfile?: Profile) => {
    if (!adminProfile || passwordSavingRef.current) return;
    passwordSavingRef.current = true;
    setPasswordSaving(true);

    try {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        setPasswordError(t("admin.profile.passwordTooShort", { count: MIN_PASSWORD_LENGTH }));
        return;
      }
      if (newPassword !== confirmPassword) {
        setPasswordError(t("admin.profile.passwordMismatch"));
        return;
      }
      setPasswordError(null);

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        console.warn("[ProfileSettingsCard] password update failed", error);
        setPasswordError(t("admin.profile.passwordUpdateError"));
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      showToast("success", t("admin.profile.passwordUpdateSuccessToast"));
    } finally {
      passwordSavingRef.current = false;
      setPasswordSaving(false);
    }
  };

  const handleLink = async (provider: OAuthProvider) => {
    setOauthError(null);
    setLinkingProvider(provider);
    try {
      const { error } = await supabase.auth.linkIdentity({ provider });
      if (error) throw error;
      // A successful call redirects away for the provider's own consent
      // flow and back -- this refetch only matters for an environment where
      // that resolves without a redirect.
      const { data } = await supabase.auth.getUserIdentities();
      setIdentities(data?.identities ?? []);
    } catch (error) {
      console.warn(`[ProfileSettingsCard] linkIdentity(${provider}) failed`, error);
      setOauthError(t("admin.profile.oauthError"));
    } finally {
      setLinkingProvider(null);
    }
  };

  if (!profile || !form) {
    return (
      <CardCustom title={t("admin.profile.title")}>
        <p className="text-sm text-muted">{t("admin.profile.loading")}</p>
      </CardCustom>
    );
  }

  return (
    <CardCustom title={t("admin.profile.title")}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface2" aria-hidden>
              <CircleUserRound className="h-8 w-8 text-muted" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{profile.full_name}</p>
            <p className="truncate text-xs text-muted">{t(`sidebar.roleBadge.${profile.role}`)}</p>
          </div>
          <button
            type="button"
            onClick={() => setAvatarModalOpen(true)}
            className="shrink-0 rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
          >
            {t("admin.profile.avatarChange")}
          </button>
        </div>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.profile.fieldFirstName")}</span>
            <input
              type="text"
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.profile.fieldLastName")}</span>
            <input
              type="text"
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
          </label>
        </div>

        {formError && <p className="text-xs text-destructive">{formError}</p>}

        <ButtonCustom variant="primary" isLoading={saving} onClick={() => void handleSave()}>
          {t("admin.profile.save")}
        </ButtonCustom>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium text-foreground">{t("admin.profile.accountSection")}</p>

          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldAccountEmail")}</span>
              <input
                type="email"
                value={accountEmail}
                onChange={(e) => {
                  setAccountEmail(e.target.value);
                  setEmailPending(false);
                }}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
            </label>
            {emailPending && (
              <p className="text-xs text-warning">{t("admin.profile.emailUpdatePendingNote", { email: accountEmail })}</p>
            )}
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            <ButtonCustom
              variant="primary"
              size="sm"
              isLoading={emailSaving}
              requiresAdminPin
              pinModalTitle={t("admin.profile.accountPinTitle")}
              onClick={handleUpdateEmail}
            >
              {t("admin.profile.updateEmail")}
            </ButtonCustom>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldNewPassword")}</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldConfirmPassword")}</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
            </label>
            {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
            <ButtonCustom
              variant="primary"
              size="sm"
              isLoading={passwordSaving}
              requiresAdminPin
              pinModalTitle={t("admin.profile.accountPinTitle")}
              onClick={handleUpdatePassword}
            >
              {t("admin.profile.updatePassword")}
            </ButtonCustom>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium text-foreground">{t("admin.profile.oauthSection")}</p>
          {oauthError && <p className="mb-2 text-xs text-destructive">{oauthError}</p>}
          <div className="flex flex-col gap-2">
            {OAUTH_PROVIDERS.map((provider) => (
              <div key={provider} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  {t(`admin.profile.oauth.${provider}`)}
                  {isLinked(provider) && <span className="badge-green">{t("admin.profile.oauthLinked")}</span>}
                </span>
                <button
                  type="button"
                  disabled={linkingProvider === provider || isLinked(provider)}
                  onClick={() => void handleLink(provider)}
                  className="rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                >
                  {isLinked(provider) ? t("admin.profile.oauthLinked") : t(`admin.profile.oauthLink.${provider}`)}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {avatarModalOpen && <AvatarEditModal profile={profile} onClose={() => setAvatarModalOpen(false)} />}
    </CardCustom>
  );
}
