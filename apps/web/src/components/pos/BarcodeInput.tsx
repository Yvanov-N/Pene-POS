import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useToast } from "@/hooks/useToast";
import { scannerService } from "@/services/hardware/scannerService";
import type { Product } from "@/types/db";

interface BarcodeInputProps {
  onProductSelect: (product: Product) => void;
  // RestockingPage wants a different not-found story (amber toast + a "go
  // create it" CTA into the catalog) than POS checkout (a cashier can't act
  // on that CTA mid-sale) -- when supplied, this replaces the default red
  // "unknown barcode" toast entirely for this instance rather than firing
  // both.
  onNotFound?: (code: string) => void;
}

export interface BarcodeInputHandle {
  focus: () => void;
}

const NOT_FOUND_MESSAGE_MS = 1500;

export const BarcodeInput = forwardRef<BarcodeInputHandle, BarcodeInputProps>(function BarcodeInput(
  { onProductSelect, onNotFound },
  ref,
) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [value, setValue] = useState("");
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const notFoundTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const lookupAndSelect = async (rawCode: string) => {
    const code = rawCode.trim();
    setValue("");
    inputRef.current?.focus();
    if (!code) return;

    const product = await db.products.where("barcode").equals(code).first();
    if (product) {
      setNotFound(false);
      onProductSelect(product);
    } else {
      setNotFound(true);
      if (onNotFound) {
        onNotFound(code);
      } else {
        showToast("error", t("pos.barcode.notFoundToast"));
      }
      clearTimeout(notFoundTimeoutRef.current);
      notFoundTimeoutRef.current = setTimeout(() => setNotFound(false), NOT_FOUND_MESSAGE_MS);
    }
  };

  const { isConnected, connectionType, connectDevice } = useBarcodeScanner({
    onScan: lookupAndSelect,
    ignoreFocusedElementRef: inputRef,
  });

  useEffect(() => {
    inputRef.current?.focus();
    return () => clearTimeout(notFoundTimeoutRef.current);
  }, []);

  const canPair = scannerService.isHidSupported() || scannerService.isSerialSupported();

  const statusLabel =
    connectionType === "hid"
      ? t("pos.barcode.connectedHid")
      : connectionType === "serial"
        ? t("pos.barcode.connectedSerial")
        : t("pos.barcode.keyboardMode");

  return (
    <div className="barcode-area flex flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        inputMode="none"
        autoComplete="off"
        value={value}
        placeholder={t("pos.barcode.placeholder")}
        className="w-full rounded-lg border border-border bg-surface2 px-4 py-3 text-lg text-foreground outline-none focus:ring-2 focus:ring-accent"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void lookupAndSelect(value);
          }
        }}
      />

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={statusLabel}>
          <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-success" : "bg-muted"}`} aria-hidden />
          {statusLabel}
        </span>
        {canPair && (
          <button
            type="button"
            onClick={() => void connectDevice()}
            className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("pos.barcode.pairScanner")}
          </button>
        )}
      </div>

      {notFound && <span className="text-sm text-destructive">{t("pos.barcode.notFound")}</span>}
    </div>
  );
});
