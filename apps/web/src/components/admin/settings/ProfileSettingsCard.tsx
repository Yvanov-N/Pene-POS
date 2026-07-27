import { useEffect, useRef, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import type { UserIdentity } from "@supabase/supabase-js";
import { CircleUserRound } from "lucide-react";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { hashPin } from "@/lib/hashPin";
import { commitLocal, makeOutboxEntry } from "@/services/sync/outbox";
import { pushOutbox } from "@/services/sync/push";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useToast } from "@/hooks/useToast";
import { PIN_LENGTH, MIN_PASSWORD_LENGTH, pinSchema, pinConfirmationSchema, passwordSchema, passwordConfirmationSchema } from "@/lib/validation";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";
import { FieldError } from "@/components/ui/field-error";
import { AvatarEditModal } from "./AvatarEditModal";
import { OtpVerifyModal } from "./OtpVerifyModal";
import { computeFullName, type Profile } from "@/types/db";

type OAuthProvider = "google" | "apple";
const OAUTH_PROVIDERS: OAuthProvider[] = ["google", "apple"];

type PendingOtpAction = "password" | "pin" | null;

interface EmailFormValues {
  accountEmail: string;
}

interface PasswordFormValues {
  newPassword: string;
  confirmPassword: string;
}

interface PinFormValues {
  newPin: string;
  confirmPin: string;
}

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
  const profile = useCurrentProfile();

  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  // Account email/password act on the real Supabase Auth login, not a plain
  // profiles-table field -- kept entirely separate from nameFormik above
  // (different backend call, different confirmation semantics), rather than
  // folded into the same "Enregistrer" button.
  // The address an OTP actually gets sent to for a PIN/password change --
  // deliberately NOT the same state as emailFormik.values.accountEmail below,
  // which mirrors whatever's currently typed in the (unsaved) email field.
  // Sending a security code to an edited-but-not-yet-confirmed address would
  // be useless (or wrong) -- this only ever updates from the real, confirmed
  // Supabase Auth session.
  const [confirmedEmail, setConfirmedEmail] = useState("");
  // Post-submit server-outcome error only -- pre-submit "required"/format
  // errors are now emailFormik's own per-field error, a separate channel.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  // profile is only populated when requiresAdminPin actually gated the
  // click -- set right before submitForm() is called, read inside
  // emailFormik's onSubmit.
  const emailPendingProfileRef = useRef<Profile | undefined>(undefined);

  // Post-submit server-outcome error only, same split as emailError above.
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // Phase 2 (the actual supabase.auth.updateUser call, fired from
  // handleOtpVerified once OTP succeeds) sits outside passwordFormik's own
  // submission lifecycle entirely -- passwordFormik.isSubmitting only spans
  // phase 1 (validate + arm the OTP modal), so this pair keeps tracking the
  // real apply step the same way it always did.
  const [passwordSaving, setPasswordSaving] = useState(false);
  const passwordSavingRef = useRef(false);
  const passwordPendingProfileRef = useRef<Profile | undefined>(undefined);

  const [pinError, setPinError] = useState<string | null>(null);
  // Same two-phase split as password above.
  const [pinSaving, setPinSaving] = useState(false);
  const pinSavingRef = useRef(false);
  const pinPendingProfileRef = useRef<Profile | undefined>(undefined);

  // Which sensitive change is waiting on email OTP confirmation -- only one
  // at a time, since both flows share the one OtpVerifyModal instance below.
  const [pendingOtpAction, setPendingOtpAction] = useState<PendingOtpAction>(null);

  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const nameFormik = useFormik<FormState>({
    initialValues: { first_name: "", last_name: "" },
    validationSchema: Yup.object({
      first_name: Yup.string().trim().required(t("admin.profile.errorFirstNameRequired")),
      last_name: Yup.string(),
    }),
    onSubmit: async (values) => {
      if (!profile) return;
      const firstName = values.first_name.trim();
      const lastName = values.last_name.trim();

      // full_name is a server-generated column (migration 00010) -- it's
      // computed here only for the optimistic local Dexie write, and
      // deliberately left OUT of the enqueued Supabase payload below
      // (Postgres rejects an UPDATE that references a generated column at
      // all, even with a matching value).
      const entry = makeOutboxEntry("generic_update", "profiles", {
        id: profile.id,
        first_name: firstName,
        last_name: lastName,
      });
      await commitLocal(
        db.profiles,
        () =>
          db.profiles.update(profile.id, {
            first_name: firstName,
            last_name: lastName,
            full_name: computeFullName(firstName, lastName),
          }),
        entry,
      );
      void pushOutbox(entry);

      showToast("success", t("admin.profile.saveSuccessToast"));
    },
  });
  const { resetForm: resetNameForm } = nameFormik;
  const [nameHydrated, setNameHydrated] = useState(false);

  useEffect(() => {
    if (profile && !nameHydrated) {
      resetNameForm({ values: profileToForm(profile) });
      setNameHydrated(true);
    }
  }, [profile, nameHydrated, resetNameForm]);

  const emailFormik = useFormik<EmailFormValues>({
    initialValues: { accountEmail: "" },
    validationSchema: Yup.object({
      accountEmail: Yup.string().trim().required(t("admin.profile.errorEmailRequired")),
    }),
    onSubmit: async (values) => {
      if (!emailPendingProfileRef.current) return;
      const newEmail = values.accountEmail.trim();
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
    },
  });

  const passwordFormik = useFormik<PasswordFormValues>({
    initialValues: { newPassword: "", confirmPassword: "" },
    validationSchema: Yup.object({
      newPassword: passwordSchema(t("admin.profile.passwordTooShort", { count: MIN_PASSWORD_LENGTH })),
      confirmPassword: passwordConfirmationSchema("newPassword", t("admin.profile.passwordMismatch")),
    }),
    // Only arms the OTP modal -- the actual supabase.auth.updateUser() call
    // is applyPasswordChange below, fired only from OtpVerifyModal's
    // onVerified so a password change genuinely can't happen without both an
    // admin PIN AND a code mailed to the account's own inbox.
    onSubmit: async () => {
      if (!passwordPendingProfileRef.current) return;
      setPasswordError(null);
      setPendingOtpAction("password");
    },
  });

  const applyPasswordChange = async () => {
    if (passwordSavingRef.current) return;
    passwordSavingRef.current = true;
    setPasswordSaving(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: passwordFormik.values.newPassword });
      if (error) {
        console.warn("[ProfileSettingsCard] password update failed", error);
        setPasswordError(t("admin.profile.passwordUpdateError"));
        return;
      }

      passwordFormik.resetForm();
      showToast("success", t("admin.profile.passwordUpdateSuccessToast"));
    } finally {
      passwordSavingRef.current = false;
      setPasswordSaving(false);
    }
  };

  const pinFormik = useFormik<PinFormValues>({
    initialValues: { newPin: "", confirmPin: "" },
    validationSchema: Yup.object({
      newPin: pinSchema(t("admin.profile.pinInvalid")),
      confirmPin: pinConfirmationSchema("newPin", t("admin.profile.pinMismatch")),
    }),
    // Same two-step split as password above -- validate + arm the OTP modal
    // here, apply the real change (both the local pin_hash cashier-switching
    // uses today and the server's bcrypt pin_code) only once OTP verifies.
    onSubmit: async () => {
      if (!pinPendingProfileRef.current) return;
      setPinError(null);
      setPendingOtpAction("pin");
    },
  });

  const applyPinChange = async () => {
    if (!profile || pinSavingRef.current) return;
    pinSavingRef.current = true;
    setPinSaving(true);

    try {
      // Server first: update_own_pin_code (migration 12) is the only way to
      // write the real bcrypt pin_code -- if it fails, the local pin_hash
      // below must NOT be written either, or this device would accept a PIN
      // the server never agreed to.
      const { error } = await supabase.rpc("update_own_pin_code", { new_pin: pinFormik.values.newPin });
      if (error) {
        console.warn("[ProfileSettingsCard] pin update failed", error);
        setPinError(t("admin.profile.pinUpdateError"));
        return;
      }

      await db.profiles.update(profile.id, { pin_hash: await hashPin(pinFormik.values.newPin) });

      pinFormik.resetForm();
      showToast("success", t("admin.profile.pinUpdateSuccessToast"));
    } finally {
      pinSavingRef.current = false;
      setPinSaving(false);
    }
  };

  const handleOtpVerified = () => {
    const action = pendingOtpAction;
    setPendingOtpAction(null);
    if (action === "password") void applyPasswordChange();
    if (action === "pin") void applyPinChange();
  };

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        void emailFormik.setFieldValue("accountEmail", data.user.email);
        setConfirmedEmail(data.user.email);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void supabase.auth.getUserIdentities().then(({ data }) => setIdentities(data?.identities ?? []));
  }, []);

  const isLinked = (provider: OAuthProvider): boolean =>
    identities?.some((identity) => identity.provider === provider) ?? false;

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

  if (!profile) {
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
              name="first_name"
              value={nameFormik.values.first_name}
              onChange={nameFormik.handleChange}
              onBlur={nameFormik.handleBlur}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
            <FieldError touched={nameFormik.touched.first_name} error={nameFormik.errors.first_name} />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-muted">{t("admin.profile.fieldLastName")}</span>
            <input
              type="text"
              name="last_name"
              value={nameFormik.values.last_name}
              onChange={nameFormik.handleChange}
              onBlur={nameFormik.handleBlur}
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
            />
          </label>
        </div>

        <ButtonCustom variant="primary" isLoading={nameFormik.isSubmitting} onClick={() => void nameFormik.submitForm()}>
          {t("admin.profile.save")}
        </ButtonCustom>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium text-foreground">{t("admin.profile.accountSection")}</p>

          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldAccountEmail")}</span>
              <input
                type="email"
                name="accountEmail"
                value={emailFormik.values.accountEmail}
                onChange={(e) => {
                  emailFormik.handleChange(e);
                  setEmailPending(false);
                }}
                onBlur={emailFormik.handleBlur}
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              <FieldError touched={emailFormik.touched.accountEmail} error={emailFormik.errors.accountEmail} />
            </label>
            {emailPending && (
              <p className="text-xs text-warning">
                {t("admin.profile.emailUpdatePendingNote", { email: emailFormik.values.accountEmail })}
              </p>
            )}
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            <ButtonCustom
              variant="primary"
              size="sm"
              isLoading={emailFormik.isSubmitting}
              requiresAdminPin
              pinModalTitle={t("admin.profile.accountPinTitle")}
              onClick={(adminProfile) => {
                emailPendingProfileRef.current = adminProfile;
                void emailFormik.submitForm();
              }}
            >
              {t("admin.profile.updateEmail")}
            </ButtonCustom>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldNewPassword")}</span>
              <input
                type="password"
                name="newPassword"
                value={passwordFormik.values.newPassword}
                onChange={passwordFormik.handleChange}
                onBlur={passwordFormik.handleBlur}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              <FieldError touched={passwordFormik.touched.newPassword} error={passwordFormik.errors.newPassword} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldConfirmPassword")}</span>
              <input
                type="password"
                name="confirmPassword"
                value={passwordFormik.values.confirmPassword}
                onChange={passwordFormik.handleChange}
                onBlur={passwordFormik.handleBlur}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              <FieldError
                touched={passwordFormik.touched.confirmPassword}
                error={passwordFormik.errors.confirmPassword}
              />
            </label>
            {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
            <ButtonCustom
              variant="primary"
              size="sm"
              isLoading={passwordFormik.isSubmitting || passwordSaving}
              requiresAdminPin
              pinModalTitle={t("admin.profile.accountPinTitle")}
              onClick={(adminProfile) => {
                passwordPendingProfileRef.current = adminProfile;
                void passwordFormik.submitForm();
              }}
            >
              {t("admin.profile.updatePassword")}
            </ButtonCustom>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldNewPin")}</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                name="newPin"
                value={pinFormik.values.newPin}
                onChange={(e) => pinFormik.setFieldValue("newPin", e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                onBlur={pinFormik.handleBlur}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              <FieldError touched={pinFormik.touched.newPin} error={pinFormik.errors.newPin} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t("admin.profile.fieldConfirmPin")}</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                name="confirmPin"
                value={pinFormik.values.confirmPin}
                onChange={(e) => pinFormik.setFieldValue("confirmPin", e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                onBlur={pinFormik.handleBlur}
                autoComplete="new-password"
                className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
              />
              <FieldError touched={pinFormik.touched.confirmPin} error={pinFormik.errors.confirmPin} />
            </label>
            {pinError && <p className="text-xs text-destructive">{pinError}</p>}
            <ButtonCustom
              variant="primary"
              size="sm"
              isLoading={pinFormik.isSubmitting || pinSaving}
              requiresAdminPin
              pinModalTitle={t("admin.profile.accountPinTitle")}
              onClick={(adminProfile) => {
                pinPendingProfileRef.current = adminProfile;
                void pinFormik.submitForm();
              }}
            >
              {t("admin.profile.updatePin")}
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

      {pendingOtpAction && (
        <OtpVerifyModal
          email={confirmedEmail}
          title={
            pendingOtpAction === "pin" ? t("admin.profile.otp.titlePin") : t("admin.profile.otp.titlePassword")
          }
          onVerified={handleOtpVerified}
          onClose={() => setPendingOtpAction(null)}
        />
      )}
    </CardCustom>
  );
}
