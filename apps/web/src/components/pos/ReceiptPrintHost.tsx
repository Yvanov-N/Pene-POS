import { useEffect, useState } from "react";
import { Receipt } from "./Receipt";
import { subscribeReceiptPrint, type ReceiptData } from "@/services/hardware/printService";

// Mounted once near the app root. printService publishes here for
// mode: 'browser' -- this renders the (visually hidden until @media print)
// .receipt DOM, then triggers window.print() once React has committed it.
export function ReceiptPrintHost() {
  const [data, setData] = useState<ReceiptData | null>(null);

  useEffect(() => subscribeReceiptPrint(setData), []);

  useEffect(() => {
    if (!data) return;
    const raf = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(raf);
  }, [data]);

  if (!data) return null;
  return <Receipt sale={data.sale} lines={data.lines} cashierName={data.cashierName} />;
}
