import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex gap-1">
      {SUPPORTED_LANGUAGES.map((lang) => {
        const isActive = i18n.resolvedLanguage === lang;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => void i18n.changeLanguage(lang)}
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
