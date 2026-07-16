import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { scannerService, type HardwareConnectionType } from "@/services/hardware/scannerService";

export type ScannerConnectionType = "keyboard" | "hid" | "serial" | "none";

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  // The already-focused input handles its own onChange/onKeyDown directly --
  // the background listener skips processing while this element is focused
  // so the same keystrokes aren't handled twice.
  ignoreFocusedElementRef?: RefObject<HTMLElement | null>;
}

interface UseBarcodeScannerResult {
  isConnected: boolean;
  connectionType: ScannerConnectionType;
  connectDevice: () => Promise<void>;
  disconnectDevice: () => Promise<void>;
}

// Scanner keystrokes arrive only a few ms apart -- far faster than any human
// typist -- so a run of keys under this gap, ending in Enter, is treated as
// a scan even when focus has drifted away from the input.
const FAST_KEY_GAP_MS = 50;
const MIN_SCAN_LENGTH = 4;
// If a hardware event and a keyboard-emulation event both resolve to the
// same code within this window, the second one is a duplicate, not a second
// scan.
const DEDUP_WINDOW_MS = 250;

export function useBarcodeScanner({
  onScan,
  ignoreFocusedElementRef,
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const [hardwareType, setHardwareType] = useState<HardwareConnectionType>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const lastEmittedRef = useRef<{ code: string; time: number } | null>(null);

  const emitScan = useCallback((rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    const now = performance.now();
    const last = lastEmittedRef.current;
    if (last && last.code === code && now - last.time < DEDUP_WINDOW_MS) {
      return;
    }
    lastEmittedRef.current = { code, time: now };
    onScanRef.current(code);
  }, []);

  // Source B: native hardware (Web HID / Web Serial).
  useEffect(() => {
    scannerService.init({
      onBarcode: emitScan,
      onConnectionChange: setHardwareType,
    });
    void scannerService.tryReconnectPreviouslyGranted();
    return () => scannerService.dispose();
  }, [emitScan]);

  // Source A: keyboard emulation, active in the background regardless of
  // hardware connection state -- a keyboard-emulation scanner needs no
  // pairing step at all.
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = 0;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (ignoreFocusedElementRef?.current && document.activeElement === ignoreFocusedElementRef.current) {
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const now = performance.now();
      const gap = now - lastKeyTime;
      const isFastFollowUp = gap <= FAST_KEY_GAP_MS;

      if (event.key === "Enter") {
        if (isFastFollowUp && buffer.length >= MIN_SCAN_LENGTH) {
          const focusedIsTextField =
            document.activeElement instanceof HTMLInputElement ||
            document.activeElement instanceof HTMLTextAreaElement;
          if (!focusedIsTextField) event.preventDefault();
          emitScan(buffer);
        }
        buffer = "";
        lastKeyTime = 0;
        return;
      }

      if (event.key.length === 1) {
        buffer = isFastFollowUp ? buffer + event.key : event.key;
        lastKeyTime = now;

        const focusedIsTextField =
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement;
        if (!focusedIsTextField && isFastFollowUp) event.preventDefault();
      } else {
        buffer = "";
        lastKeyTime = 0;
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [emitScan, ignoreFocusedElementRef]);

  const connectDevice = useCallback(async () => {
    const preferred = scannerService.isSerialSupported() ? "serial" : "hid";
    await scannerService.requestDevice(preferred);
  }, []);

  const disconnectDevice = useCallback(async () => {
    await scannerService.disconnect();
  }, []);

  return {
    isConnected: hardwareType !== null,
    connectionType: hardwareType ?? "keyboard",
    connectDevice,
    disconnectDevice,
  };
}
