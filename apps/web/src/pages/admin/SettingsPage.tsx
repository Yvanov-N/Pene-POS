import { useTranslation } from "react-i18next";
import { PrinterSettingsCard } from "@/components/admin/settings/PrinterSettingsCard";
import { ScannerSettingsCard } from "@/components/admin/settings/ScannerSettingsCard";
import { NotificationSettingsCard } from "@/components/admin/settings/NotificationSettingsCard";
import { ShopStatusCard } from "@/components/admin/settings/ShopStatusCard";

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-foreground">{t("admin.settings.title")}</h1>
      <ShopStatusCard />
      <PrinterSettingsCard />
      <ScannerSettingsCard />
      <NotificationSettingsCard />
    </div>
  );
}
