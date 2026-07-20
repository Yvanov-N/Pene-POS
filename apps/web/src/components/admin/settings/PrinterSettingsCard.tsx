import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { printService } from "@/services/hardware/printService";
import { CardCustom } from "@/components/ui/card-custom";
import type { PrintMode } from "@/types/db";

const SETTINGS_ID = "default";
const PRINT_MODES: PrintMode[] = ["browser", "bluetooth"];

type BluetoothStatus = "idle" | "connecting" | "connected";

export function PrinterSettingsCard() {
  const { t } = useTranslation();
  const settings = useLiveQuery(() => db.local_settings.get(SETTINGS_ID), []);
  const [bluetoothStatus, setBluetoothStatus] = useState<BluetoothStatus>(
    printService.isBluetoothPrinterConnected() ? "connected" : "idle",
  );
  const [printerName, setPrinterName] = useState<string | null>(printService.getBluetoothPrinterName());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const printMode: PrintMode = settings?.printMode ?? "browser";

  const setPrintMode = async (mode: PrintMode) => {
    await db.local_settings.put({ id: SETTINGS_ID, printMode: mode });
  };

  const handlePairBluetooth = async () => {
    setErrorMessage(null);
    if (!printService.isBluetoothSupported()) {
      setErrorMessage(t("admin.settings.bluetoothUnsupported"));
      return;
    }
    setBluetoothStatus("connecting");
    try {
      await printService.connectBluetoothPrinter();
      setBluetoothStatus("connected");
      setPrinterName(printService.getBluetoothPrinterName());
    } catch (error) {
      console.warn("[PrinterSettingsCard] bluetooth pairing failed", error);
      setBluetoothStatus("idle");
      setErrorMessage(t("admin.settings.bluetoothPairError"));
    }
  };

  const handleDisconnectBluetooth = async () => {
    await printService.disconnectBluetoothPrinter();
    setBluetoothStatus("idle");
    setPrinterName(null);
  };

  return (
    <CardCustom title={t("admin.settings.printerCardTitle")}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">{t("admin.settings.printModeLabel")}</p>
          <div className="grid grid-cols-2 gap-2">
            {PRINT_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => void setPrintMode(mode)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  printMode === mode
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-surface2 text-muted hover:text-foreground"
                }`}
              >
                {t(`admin.settings.printMode.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium text-foreground">{t("admin.settings.bluetoothSection")}</p>
          <span className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted">
            <span
              className={`h-2 w-2 rounded-full ${bluetoothStatus === "connected" ? "bg-success" : "bg-muted"}`}
              aria-hidden
            />
            {bluetoothStatus === "connected"
              ? t("admin.settings.bluetoothConnectedName", { name: printerName ?? "?" })
              : t("admin.settings.bluetoothDisconnected")}
          </span>

          {errorMessage && <p className="mb-2 text-xs text-destructive">{errorMessage}</p>}

          {bluetoothStatus === "connected" ? (
            <button
              type="button"
              onClick={() => void handleDisconnectBluetooth()}
              className="w-full rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground hover:border-accent"
            >
              {t("admin.settings.disconnectBluetooth")}
            </button>
          ) : (
            <button
              type="button"
              disabled={bluetoothStatus === "connecting"}
              onClick={() => void handlePairBluetooth()}
              className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {t("admin.settings.pairBluetooth")}
            </button>
          )}
        </div>
      </div>
    </CardCustom>
  );
}
