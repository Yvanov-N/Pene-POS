import { useTranslation } from "react-i18next";
import { ProfileSettingsCard } from "@/components/admin/settings/ProfileSettingsCard";
import { DeviceSettingsCard } from "@/components/admin/settings/DeviceSettingsCard";
import { PrinterSettingsCard } from "@/components/admin/settings/PrinterSettingsCard";
import { ScannerSettingsCard } from "@/components/admin/settings/ScannerSettingsCard";
import { NotificationSettingsCard } from "@/components/admin/settings/NotificationSettingsCard";
import { ShopStatusCard } from "@/components/admin/settings/ShopStatusCard";
import { AboutSettingsCard } from "@/components/admin/settings/AboutSettingsCard";
import { DataBackupCard } from "@/components/admin/settings/DataBackupCard";

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="w-full p-4">
      <h1 className="mb-4 text-lg font-semibold text-foreground">{t("admin.settings.title")}</h1>
      {/* Two columns of tiles from lg up (6 + 6), one below. CSS columns
          rather than a grid: the cards differ a lot in height (profile vs.
          device), and a grid row would stretch the short one into a mostly
          empty tile -- here each card keeps its own height and the next one
          stacks right under it. */}
      <div className="gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <ProfileSettingsCard />
        <DeviceSettingsCard />
        <ShopStatusCard />
        <PrinterSettingsCard />
        <ScannerSettingsCard />
        <NotificationSettingsCard />
      </div>
      {/* Emergency tool, kept apart near the bottom, full width -- then
          "About", always the last tile. */}
      <div className="flex flex-col gap-4">
        <DataBackupCard />
        <AboutSettingsCard />
      </div>
    </div>
  );
}
