import { useTranslation } from "react-i18next";
import type { VersionInfo } from "@/types/version";

interface ChangelogModalProps {
  info: VersionInfo;
  onClose: () => void;
}

export function ChangelogModal({ info, onClose }: ChangelogModalProps) {
  const { t, i18n } = useTranslation();
  const formattedDate = info.buildDate
    ? new Intl.DateTimeFormat(i18n.language).format(new Date(info.buildDate))
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("update.changelog.title")} · v{info.version}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("update.changelog.close")}
          >
            ✕
          </button>
        </div>
        {formattedDate && <p className="mb-3 text-xs text-muted">{formattedDate}</p>}
        <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
          {info.changes.map((change, index) => (
            <li key={index}>{change}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
