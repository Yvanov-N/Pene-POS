import { useTranslation } from "react-i18next";
import type { VersionInfo } from "@/types/version";

interface UpdateBannerProps {
  available: boolean;
  snoozed: boolean;
  info: VersionInfo | null;
  applying: boolean;
  onUpdate: () => void;
  onSnooze: () => void;
  onReopen: () => void;
  onShowChangelog: () => void;
}

export function UpdateBanner({
  available,
  snoozed,
  info,
  applying,
  onUpdate,
  onSnooze,
  onReopen,
  onShowChangelog,
}: UpdateBannerProps) {
  const { t } = useTranslation();

  if (!available) return null;

  if (snoozed) {
    return (
      <button
        type="button"
        onClick={onReopen}
        aria-label={t("update.toast.titleWithVersion", { version: info?.version ?? "" })}
        className="update-pill animate-pulse"
      >
        <span aria-hidden>↻</span>
      </button>
    );
  }

  return (
    <div className="toast-viewport">
      <div className="toast">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {t("update.toast.titleWithVersion", { version: info?.version ?? "?" })}
        </p>
        <p className="mt-1 text-sm text-muted">{t("update.toast.message")}</p>
        {info && (
          <button
            type="button"
            onClick={onShowChangelog}
            className="mt-1 text-xs text-muted underline hover:text-foreground"
          >
            {t("update.toast.viewChangelog")}
          </button>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onSnooze}
            disabled={applying}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-50"
          >
            {t("update.toast.later")}
          </button>
          <button
            type="button"
            onClick={onUpdate}
            disabled={applying}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {t("update.toast.updateNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
