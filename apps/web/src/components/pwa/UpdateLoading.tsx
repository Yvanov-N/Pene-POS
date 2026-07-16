import { useTranslation } from "react-i18next";
import logo from "@/assets/logo.png";
import type { VersionInfo } from "@/types/version";

interface UpdateLoadingProps {
  info: VersionInfo | null;
}

export function UpdateLoading({ info }: UpdateLoadingProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-background">
      <img src={logo} alt="" className="h-16 w-16 object-contain" aria-hidden />
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden
      />
      <p className="text-sm text-muted">{t("update.loading.text", { version: info?.version ?? "" })}</p>
    </div>
  );
}
