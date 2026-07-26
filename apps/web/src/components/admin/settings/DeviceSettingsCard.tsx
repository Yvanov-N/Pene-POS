import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { getDeviceLabel } from "@/lib/deviceLabel";
import { useToast } from "@/hooks/useToast";
import { CardCustom } from "@/components/ui/card-custom";
import { ButtonCustom } from "@/components/ui/button-custom";

const SETTINGS_ID = "default";

// Lets an admin name this specific device (e.g. "yaounde", "buea") -- shown
// combined with the auto-detected platform (lib/deviceLabel.ts) as this
// device's attribution label on every sale it rings up going forward
// (hooks/usePosCheckout.ts), replacing the old PIN-matched cashier name.
// Device-local only, same as PrinterSettingsCard's printMode -- deliberately
// never synced (a location name is meaningless on any device but this one).
export function DeviceSettingsCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const settings = useLiveQuery(() => db.local_settings.get(SETTINGS_ID), []);
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  // Only overwrite the input's live-edited value once, when the row first
  // resolves from Dexie -- otherwise every keystroke's re-render would keep
  // resetting it back to the last-saved value via this same effect.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!hydrated && settings !== undefined) {
      setLocation(settings?.deviceLocation ?? "");
      setHydrated(true);
    }
  }, [settings, hydrated]);

  const currentLabel = getDeviceLabel(settings?.deviceLocation);

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmed = location.trim();
      await db.local_settings.put({
        id: SETTINGS_ID,
        printMode: settings?.printMode ?? "browser",
        autoPrintReceipts: settings?.autoPrintReceipts ?? false,
        deviceLocation: trimmed || undefined,
      });
      showToast("success", t("admin.settings.deviceSaveSuccessToast", { label: getDeviceLabel(trimmed) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CardCustom title={t("admin.settings.deviceCardTitle")}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t("admin.settings.deviceCardSub")}</p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t("admin.settings.deviceCurrentLabel")}</span>
          <span className="font-medium text-foreground">{currentLabel}</span>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("admin.settings.deviceLocationLabel")}</span>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t("admin.settings.deviceLocationPlaceholder")}
            className="rounded-lg border border-border bg-surface2 px-3 py-2 text-foreground"
          />
        </label>
        <ButtonCustom variant="primary" size="sm" isLoading={saving} onClick={() => void handleSave()}>
          {t("admin.settings.deviceSaveButton")}
        </ButtonCustom>
      </div>
    </CardCustom>
  );
}
