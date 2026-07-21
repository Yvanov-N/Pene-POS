import { useTranslation } from "react-i18next";
import { ProfileSettingsCard } from "@/components/admin/settings/ProfileSettingsCard";
import { PrinterSettingsCard } from "@/components/admin/settings/PrinterSettingsCard";
import { ScannerSettingsCard } from "@/components/admin/settings/ScannerSettingsCard";
import { NotificationSettingsCard } from "@/components/admin/settings/NotificationSettingsCard";
import { ShopStatusCard } from "@/components/admin/settings/ShopStatusCard";
import { AboutSettingsCard } from "@/components/admin/settings/AboutSettingsCard";

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-foreground">{t("admin.settings.title")}</h1>
      <ProfileSettingsCard />
      <ShopStatusCard />
      <PrinterSettingsCard />
      <ScannerSettingsCard />
      <NotificationSettingsCard />
      <AboutSettingsCard />
    </div>
  );
}
