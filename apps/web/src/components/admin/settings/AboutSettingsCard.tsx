import { useTranslation } from "react-i18next";
import { useAppVersion } from "@/hooks/useAppVersion";
import { CardCustom } from "@/components/ui/card-custom";

export function AboutSettingsCard() {
  const { t, i18n } = useTranslation();
  const { info, loading } = useAppVersion();

  const formattedDate = info?.buildDate
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(info.buildDate),
      )
    : null;

  return (
    <CardCustom title={t("admin.settings.aboutCardTitle")}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t("admin.settings.aboutVersionLabel")}</span>
          <span className="text-sm font-semibold text-foreground">
            {loading
              ? t("admin.settings.aboutLoading")
              : info
                ? `v${info.version}`
                : t("admin.settings.aboutUnavailable")}
          </span>
        </div>
        {info && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t("admin.settings.aboutBuildLabel")}</span>
            <span className="font-mono text-xs text-foreground">{info.buildId}</span>
          </div>
        )}
        {formattedDate && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t("admin.settings.aboutBuildDateLabel")}</span>
            <span className="text-xs text-foreground">{formattedDate}</span>
          </div>
        )}
      </div>
    </CardCustom>
  );
}
