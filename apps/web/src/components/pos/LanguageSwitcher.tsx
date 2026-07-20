import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { db } from "@/lib/db";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import type { PreferredLanguage } from "@/types/db";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { triggerManualSync } = useSyncEngine();
  const profile = useCurrentProfile();
  // Applies the profile's saved language once when it first resolves (e.g.
  // this device's account prefers "en" but the browser/localStorage default
  // is "fr") without fighting a manual switch made afterward.
  const appliedProfileLanguageRef = useRef(false);

  useEffect(() => {
    if (!profile || appliedProfileLanguageRef.current) return;
    appliedProfileLanguageRef.current = true;
    if (profile.preferred_language !== i18n.resolvedLanguage) {
      void i18n.changeLanguage(profile.preferred_language);
    }
  }, [profile, i18n]);

  const handleChange = async (lang: PreferredLanguage) => {
    await i18n.changeLanguage(lang);
    if (!profile) return;

    // Best-effort persistence -- a signed-in device's own account should
    // reopen in the language it was last switched to, not silently drift
    // back to the browser default. Never blocks the actual language switch,
    // which already happened above regardless of whether a profile exists.
    await db.profiles.update(profile.id, { preferred_language: lang });
    await enqueueMutation("UPDATE", "profiles", { id: profile.id, preferred_language: lang });
    void triggerManualSync();
  };

  return (
    <div className="flex gap-1">
      {SUPPORTED_LANGUAGES.map((lang) => {
        const isActive = i18n.resolvedLanguage === lang;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => void handleChange(lang)}
            aria-pressed={isActive}
            className={`rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
              isActive
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-surface2 text-muted hover:text-foreground"
            }`}
          >
            {t(`language.${lang}`)}
          </button>
        );
      })}
    </div>
  );
}
