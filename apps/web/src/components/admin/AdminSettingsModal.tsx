import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { printService } from "@/services/hardware/printService";
import {
  isPushSupported,
  isPushSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/services/pushService";
import { CardCustom } from "@/components/ui/card-custom";
import type { PrintMode } from "@/types/db";

const SETTINGS_ID = "default";
const PRINT_MODES: PrintMode[] = ["browser", "bluetooth"];
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

type BluetoothStatus = "idle" | "connecting" | "connected";
type PushStatus = "checking" | "enabled" | "disabled";

export function AdminSettingsModal() {
  const { t } = useTranslation();
  const settings = useLiveQuery(() => db.local_settings.get(SETTINGS_ID), []);
  const [bluetoothStatus, setBluetoothStatus] = useState<BluetoothStatus>(
    printService.isBluetoothPrinterConnected() ? "connected" : "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus>("checking");
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    void isPushSubscribed().then((subscribed) => setPushStatus(subscribed ? "enabled" : "disabled"));
  }, []);

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
    } catch (error) {
      console.warn("[AdminSettingsModal] bluetooth pairing failed", error);
      setBluetoothStatus("idle");
      setErrorMessage(t("admin.settings.bluetoothPairError"));
    }
  };

  const handleDisconnectBluetooth = async () => {
    await printService.disconnectBluetoothPrinter();
    setBluetoothStatus("idle");
  };

  const handleEnablePush = async () => {
    setPushError(null);
    if (!isPushSupported()) {
      setPushError(t("admin.settings.pushUnsupported"));
      return;
    }
    if (!VAPID_PUBLIC_KEY) {
      setPushError(t("admin.settings.pushMisconfigured"));
      return;
    }
    try {
      await subscribeToPush(VAPID_PUBLIC_KEY);
      setPushStatus("enabled");
    } catch (error) {
      console.warn("[AdminSettingsModal] push subscription failed", error);
      setPushError(t("admin.settings.pushError"));
    }
  };

  const handleDisablePush = async () => {
    await unsubscribeFromPush();
    setPushStatus("disabled");
  };

  return (
    <CardCustom className="mx-auto max-w-md" title={t("admin.settings.title")}>
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
                ? t("admin.settings.bluetoothConnected")
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

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-sm font-medium text-foreground">{t("admin.settings.pushSection")}</p>
            <span className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted">
              <span
                className={`h-2 w-2 rounded-full ${pushStatus === "enabled" ? "bg-success" : "bg-muted"}`}
                aria-hidden
              />
              {pushStatus === "enabled"
                ? t("admin.settings.pushEnabled")
                : t("admin.settings.pushDisabled")}
            </span>

            {pushError && <p className="mb-2 text-xs text-destructive">{pushError}</p>}

            {pushStatus === "enabled" ? (
              <button
                type="button"
                onClick={() => void handleDisablePush()}
                className="w-full rounded-lg border border-border bg-surface2 py-2 text-sm font-medium text-foreground hover:border-accent"
              >
                {t("admin.settings.disablePush")}
              </button>
            ) : (
              <button
                type="button"
                disabled={pushStatus === "checking"}
                onClick={() => void handleEnablePush()}
                className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                {t("admin.settings.enablePush")}
              </button>
            )}
          </div>
        </div>
    </CardCustom>
  );
}
