// Minimal ambient types for the subset of the Web HID / Web Serial APIs this
// app actually uses. TypeScript's bundled lib.dom.d.ts has no coverage for
// either API (confirmed against the installed TS version) -- this is
// deliberately narrow rather than a full spec surface or an external
// @types package.

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
  ): void;
  removeEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
  ): void;
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
}

interface HIDRequestDeviceOptions {
  filters: HIDDeviceFilter[];
}

interface HID extends EventTarget {
  requestDevice(options: HIDRequestDeviceOptions): Promise<HIDDevice[]>;
  getDevices(): Promise<HIDDevice[]>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (event: HIDConnectionEvent) => void,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (event: HIDConnectionEvent) => void,
  ): void;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
  addEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void;
  removeEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void;
}

interface Navigator {
  readonly hid?: HID;
  readonly serial?: Serial;
}
