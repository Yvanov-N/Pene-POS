import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import type { Product } from "@/types/db";

interface BarcodeInputProps {
  onProductSelect: (product: Product) => void;
}

// Scanner keystrokes arrive only a few ms apart -- far faster than any human
// typist -- so a run of keys under this gap, ending in Enter, is treated as
// a scan even when focus has drifted away from the input.
const FAST_KEY_GAP_MS = 50;
const MIN_SCAN_LENGTH = 4;
const NOT_FOUND_MESSAGE_MS = 1500;

export function BarcodeInput({ onProductSelect }: BarcodeInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const notFoundTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

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
      clearTimeout(notFoundTimeoutRef.current);
      notFoundTimeoutRef.current = setTimeout(() => setNotFound(false), NOT_FOUND_MESSAGE_MS);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    return () => clearTimeout(notFoundTimeoutRef.current);
  }, []);

  // Background fallback: catches scans even if focus lands elsewhere.
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = 0;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
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
          void lookupAndSelect(buffer);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {notFound && (
        <span className="text-sm text-destructive">{t("pos.barcode.notFound")}</span>
      )}
    </div>
  );
}
