import { describe, expect, it, afterEach, vi } from "vitest";
import { getDeviceLabel } from "@/lib/deviceLabel";

function setUserAgent(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua });
}

describe("getDeviceLabel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects macOS and combines it with a location", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    expect(getDeviceLabel("yaounde")).toBe("macos-yaounde");
  });

  it("detects iOS", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    expect(getDeviceLabel("buea")).toBe("ios-buea");
  });

  it("detects Android", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8)");
    expect(getDeviceLabel("buea")).toBe("android-buea");
  });

  it("detects Windows", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(getDeviceLabel("yaounde")).toBe("windows-yaounde");
  });

  it("falls back to just the platform when no location is set", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(getDeviceLabel(undefined)).toBe("macos");
    expect(getDeviceLabel("")).toBe("macos");
    expect(getDeviceLabel("   ")).toBe("macos");
  });
});
