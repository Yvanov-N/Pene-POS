import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { scannerService } from "@/services/hardware/scannerService";
import { CardCustom } from "@/components/ui/card-custom";

// This card is only ever routed to on /admin/settings, which is mutually
// exclusive with the POS route (react-router renders one route element at a
// time) -- so mounting a second useBarcodeScanner instance here is safe, per
// the singleton-hardware-connection hazard documented in the hook itself.
// It would NOT be safe to add this same diagnostic to a screen that also
// renders BarcodeInput/PosCart.
export function ScannerSettingsCard() {
  const { t } = useTranslation();
  const [testValue, setTestValue] = useState("");
  const [lastScan, setLastScan] = useState<{ code: string; time: string } | null>(null);
  const testInputRef = useRef<HTMLInputElement>(null);

  const recordScan = (code: string) => {
    setLastScan({ code, time: new Date().toLocaleTimeString() });
    setTestValue("");
  };

  const { isConnected, connectionType, connectDevice, disconnectDevice } = useBarcodeScanner({
    onScan: recordScan,
    ignoreFocusedElementRef: testInputRef,
  });

  const canPair = scannerService.isHidSupported() || scannerService.isSerialSupported();

  const statusLabel =
    connectionType === "hid"
      ? t("pos.barcode.connectedHid")
      : connectionType === "serial"
        ? t("pos.barcode.connectedSerial")
        : t("pos.barcode.keyboardMode");

  return (
    <CardCustom title={t("admin.settings.scannerCardTitle")}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={statusLabel}>
            <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-success" : "bg-muted"}`} aria-hidden />
            {statusLabel}
          </span>
          {canPair &&
            (isConnected ? (
              <button
                type="button"
                onClick={() => void disconnectDevice()}
                className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
              >
                {t("admin.settings.disconnectScanner")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void connectDevice()}
                className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
              >
                {t("pos.barcode.pairScanner")}
              </button>
            ))}
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium text-foreground">{t("admin.settings.scannerTestLabel")}</p>
          <input
            ref={testInputRef}
            type="text"
            inputMode="none"
            autoComplete="off"
            value={testValue}
            placeholder={t("admin.settings.scannerTestPlaceholder")}
            className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            onChange={(event) => setTestValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (testValue.trim()) recordScan(testValue);
              }
            }}
          />
          <p className="mt-2 text-xs text-muted">{t("admin.settings.scannerTestHint")}</p>

          {lastScan && (
            <p className="mt-3 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground">
              {t("admin.settings.scannerTestResult", { code: lastScan.code, time: lastScan.time })}
            </p>
          )}
        </div>
      </div>
    </CardCustom>
  );
}
