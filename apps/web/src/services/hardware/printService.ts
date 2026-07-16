import i18n from "@/i18n";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import type { PrintMode, Sale, SaleItem } from "@/types/db";

// A commonly-used service/characteristic UUID pair for generic "ESC/POS over
// BLE" thermal printer modules (many inexpensive receipt printers expose
// this exact pair) -- there's no Bluetooth-SIG-standard GATT profile for
// thermal printers, so this is a reasonable default, not a guarantee. We
// request with acceptAllDevices so the user can still pick a printer whose
// service differs; connecting then fails with a clear, catchable error
// rather than silently picking the wrong device.
const PRINTER_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

// Real GATT characteristics on cheap BLE printer modules typically can't
// take a large write in one call -- chunk conservatively with a short delay
// between writes to avoid overflowing the printer's input buffer.
const BLE_CHUNK_SIZE = 20;
const BLE_CHUNK_DELAY_MS = 20;

export interface ReceiptLine {
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface ReceiptData {
  sale: Sale;
  lines: ReceiptLine[];
  cashierName: string;
}

// -- Browser-mode print bus --------------------------------------------
// printReceipt() doesn't render React itself (it's a plain service), so it
// publishes the resolved receipt data here; ReceiptPrintHost (mounted once
// near the app root) subscribes, renders <Receipt>, and calls window.print()
// once that DOM has committed.
type ReceiptPrintListener = (data: ReceiptData | null) => void;
const receiptPrintListeners = new Set<ReceiptPrintListener>();
let currentReceiptPrintData: ReceiptData | null = null;

function publishReceiptForPrint(data: ReceiptData | null): void {
  currentReceiptPrintData = data;
  receiptPrintListeners.forEach((listener) => listener(data));
}

export function subscribeReceiptPrint(listener: ReceiptPrintListener): () => void {
  receiptPrintListeners.add(listener);
  listener(currentReceiptPrintData);
  return () => receiptPrintListeners.delete(listener);
}

// -- ESC/POS byte encoding ------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;

function buildEscPosBytes(data: ReceiptData): Uint8Array {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const raw = (...values: number[]) => bytes.push(...values);
  const text = (value: string) => bytes.push(...encoder.encode(value));

  raw(ESC, 0x40); // initialize
  raw(ESC, 0x61, 1); // center align
  text(`${i18n.t("receipt.shopName")}\n`);
  raw(ESC, 0x61, 0); // left align
  text(`${new Date(data.sale.created_at).toLocaleString()}\n`);
  text(`${i18n.t("receipt.cashier", { name: data.cashierName })}\n`);
  text("--------------------------------\n");

  for (const line of data.lines) {
    text(`${line.quantity} x ${line.productName}\n`);
    text(`  ${formatCurrency(line.quantity * line.unitPrice)}\n`);
  }

  text("--------------------------------\n");
  raw(ESC, 0x45, 1); // bold on
  text(`${i18n.t("pos.cart.total")}: ${formatCurrency(data.sale.total_amount)}\n`);
  raw(ESC, 0x45, 0); // bold off
  text(`${i18n.t(`pos.cart.paymentMethod.${data.sale.payment_method}`)}\n`);
  raw(ESC, 0x61, 1); // center align
  text(`\n${i18n.t("receipt.footer")}\n\n\n`);
  raw(GS, 0x56, 0x41); // paper cut

  return new Uint8Array(bytes);
}

async function writeInChunks(
  characteristic: BluetoothRemoteGATTCharacteristic,
  payload: Uint8Array,
): Promise<void> {
  for (let offset = 0; offset < payload.length; offset += BLE_CHUNK_SIZE) {
    const chunk = payload.slice(offset, offset + BLE_CHUNK_SIZE);
    if (characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await new Promise((resolve) => setTimeout(resolve, BLE_CHUNK_DELAY_MS));
  }
}

class PrintService {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  isBluetoothSupported(): boolean {
    return typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
  }

  isBluetoothPrinterConnected(): boolean {
    return this.characteristic !== null && (this.device?.gatt?.connected ?? false);
  }

  async connectBluetoothPrinter(): Promise<void> {
    if (!this.isBluetoothSupported()) {
      throw new Error("web-bluetooth-unsupported");
    }

    const device = await navigator.bluetooth!.requestDevice({
      acceptAllDevices: true,
      optionalServices: [PRINTER_SERVICE_UUID],
    });

    const server = await device.gatt?.connect();
    if (!server) throw new Error("bluetooth-gatt-unavailable");

    const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

    device.addEventListener("gattserverdisconnected", this.handleGattDisconnected);

    this.device = device;
    this.characteristic = characteristic;
  }

  async disconnectBluetoothPrinter(): Promise<void> {
    this.device?.removeEventListener("gattserverdisconnected", this.handleGattDisconnected);
    this.device?.gatt?.disconnect();
    this.device = null;
    this.characteristic = null;
  }

  private handleGattDisconnected = (): void => {
    this.characteristic = null;
  };

  async printReceipt(sale: Sale, items: SaleItem[], mode: PrintMode): Promise<void> {
    const data = await this.buildReceiptData(sale, items);

    if (mode === "bluetooth") {
      if (!this.characteristic) {
        throw new Error("bluetooth-printer-not-connected");
      }
      const payload = buildEscPosBytes(data);
      await writeInChunks(this.characteristic, payload);
      return;
    }

    publishReceiptForPrint(data);
  }

  private async buildReceiptData(sale: Sale, items: SaleItem[]): Promise<ReceiptData> {
    const [cashier, products] = await Promise.all([
      db.profiles.get(sale.cashier_id),
      Promise.all(items.map((item) => db.products.get(item.product_id))),
    ]);

    const lines: ReceiptLine[] = items.map((item, index) => ({
      productName: products[index]?.name ?? "?",
      quantity: item.quantity,
      unitPrice: item.unit_price,
    }));

    return { sale, lines, cashierName: cashier?.full_name ?? "-" };
  }
}

export const printService = new PrintService();
