// Native hardware scanner support (Web HID / Web Serial), layered alongside
// the keyboard-emulation path in useBarcodeScanner. Both browser APIs are
// Chromium-only and require a secure context + a user gesture to request a
// device -- see the pairing button in BarcodeInput.tsx.
//
// Web HID cannot see a scanner running in standard USB-keyboard-emulation
// mode: Chromium blocklists the standard keyboard HID usage page from
// requestDevice() for the obvious reason that a website silently reading raw
// keyboard reports would be a way to sniff passwords typed anywhere on the
// system. Web HID only sees scanners specifically switched into a
// vendor-specific "HID POS" mode. Web Serial has no such restriction and is
// the more broadly useful path for scanners with a switchable USB-serial mode.

export type HardwareConnectionType = "hid" | "serial" | null;

const SERIAL_BAUD_RATE = 9600;

// Barcode lines can arrive split across multiple HID reports / serial reads,
// or multiple lines can arrive in a single one -- this buffers raw bytes and
// emits each complete, trimmed line exactly once, collapsing a \r\n pair
// into a single terminator so nothing emits an empty line between them.
class LineBuffer {
  private buffer = "";
  private decoder = new TextDecoder();

  push(bytes: Uint8Array, emit: (line: string) => void): void {
    this.buffer += this.decoder.decode(bytes, { stream: true });

    let index = this.buffer.search(/[\r\n]/);
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      let rest = this.buffer.slice(index + 1);
      if (this.buffer[index] === "\r" && rest[0] === "\n") {
        rest = rest.slice(1);
      }
      this.buffer = rest;
      if (line) emit(line);
      index = this.buffer.search(/[\r\n]/);
    }
  }
}

interface ScannerServiceCallbacks {
  onBarcode: (barcode: string) => void;
  onConnectionChange: (type: HardwareConnectionType) => void;
}

class ScannerService {
  private callbacks: ScannerServiceCallbacks | null = null;
  private hidDevice: HIDDevice | null = null;
  private serialPort: SerialPort | null = null;
  private serialReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private serialReadLoopActive = false;
  private hidLineBuffer = new LineBuffer();
  private serialLineBuffer = new LineBuffer();

  // `in` only proves the property key exists -- it can be `true` even when
  // the value itself is undefined (e.g. a property explicitly set to
  // undefined by a polyfill/extension), which then crashes the very next
  // `navigator.hid!.addEventListener(...)` call. Checking truthiness of the
  // value itself is what actually guarantees the API is usable.
  isHidSupported(): boolean {
    return typeof navigator !== "undefined" && Boolean(navigator.hid);
  }

  isSerialSupported(): boolean {
    return typeof navigator !== "undefined" && Boolean(navigator.serial);
  }

  init(callbacks: ScannerServiceCallbacks): void {
    this.callbacks = callbacks;
    if (this.isHidSupported()) {
      navigator.hid!.addEventListener("disconnect", this.handleHidDisconnect);
    }
  }

  dispose(): void {
    if (this.isHidSupported()) {
      navigator.hid!.removeEventListener("disconnect", this.handleHidDisconnect);
    }
    void this.disconnect();
    this.callbacks = null;
  }

  // Reconnects to a device/port the user already granted permission for in a
  // prior session -- no new picker prompt needed, so this can run on mount.
  async tryReconnectPreviouslyGranted(): Promise<void> {
    if (this.hidDevice || this.serialPort) return;

    if (this.isHidSupported()) {
      const devices = await navigator.hid!.getDevices();
      if (devices.length > 0) {
        await this.connectHid(devices[0]);
        return;
      }
    }
    if (this.isSerialSupported()) {
      const ports = await navigator.serial!.getPorts();
      if (ports.length > 0) {
        await this.connectSerial(ports[0]);
      }
    }
  }

  // Must be called synchronously from within a user gesture (click handler)
  // -- the browser only shows the device picker in direct response to one.
  async requestDevice(preferred: "hid" | "serial"): Promise<boolean> {
    try {
      if (preferred === "serial" && this.isSerialSupported()) {
        const port = await navigator.serial!.requestPort();
        await this.connectSerial(port);
        return true;
      }
      if (preferred === "hid" && this.isHidSupported()) {
        const devices = await navigator.hid!.requestDevice({ filters: [] });
        if (devices.length === 0) return false;
        await this.connectHid(devices[0]);
        return true;
      }
    } catch (error) {
      // User cancelled the picker, or the device failed to open -- not a bug.
      console.warn("[scannerService] requestDevice failed", error);
    }
    return false;
  }

  async disconnect(): Promise<void> {
    this.serialReadLoopActive = false;

    if (this.hidDevice) {
      this.hidDevice.removeEventListener("inputreport", this.handleHidInputReport);
      try {
        await this.hidDevice.close();
      } catch {
        // already closed / unplugged
      }
      this.hidDevice = null;
    }

    if (this.serialReader) {
      try {
        await this.serialReader.cancel();
      } catch {
        // already released
      }
    }
    if (this.serialPort) {
      try {
        await this.serialPort.close();
      } catch {
        // already closed / unplugged
      }
      this.serialPort = null;
    }

    this.callbacks?.onConnectionChange(null);
  }

  private async connectHid(device: HIDDevice): Promise<void> {
    await this.disconnect();
    if (!device.opened) await device.open();
    device.addEventListener("inputreport", this.handleHidInputReport);
    this.hidDevice = device;
    this.callbacks?.onConnectionChange("hid");
  }

  private async connectSerial(port: SerialPort): Promise<void> {
    await this.disconnect();
    await port.open({ baudRate: SERIAL_BAUD_RATE });
    this.serialPort = port;
    this.callbacks?.onConnectionChange("serial");
    void this.readSerialLoop(port);
  }

  private handleHidInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    this.hidLineBuffer.push(bytes, (line) => this.callbacks?.onBarcode(line));
  };

  private async readSerialLoop(port: SerialPort): Promise<void> {
    if (!port.readable) return;
    this.serialReadLoopActive = true;
    const reader = port.readable.getReader();
    this.serialReader = reader;

    try {
      while (this.serialReadLoopActive) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.serialLineBuffer.push(value, (line) => this.callbacks?.onBarcode(line));
      }
    } catch (error) {
      // A pulled cable / device sleep surfaces here as a rejected read --
      // treat it the same as an explicit disconnect rather than throwing
      // into the app.
      console.warn("[scannerService] serial read loop ended", error);
    } finally {
      reader.releaseLock();
      if (this.serialPort === port) {
        this.serialPort = null;
        this.serialReader = null;
        this.callbacks?.onConnectionChange(null);
      }
    }
  }

  private handleHidDisconnect = (event: HIDConnectionEvent): void => {
    if (event.device === this.hidDevice) {
      this.hidDevice = null;
      this.callbacks?.onConnectionChange(null);
    }
  };
}

export const scannerService = new ScannerService();
