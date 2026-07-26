// Computes a human-readable "which terminal rang this up" label for sales
// attribution, replacing the old cashier-PIN-matched profile name (see
// hooks/usePosCheckout.ts). Purely cosmetic/display -- not a security or
// identity mechanism (checkout's admin-PIN gate is what actually
// authorizes the sale; this just answers "which physical device", not
// "who is allowed").
//
// navigator.userAgent sniffing, not navigator.userAgentData -- the latter
// (Client Hints) is Chromium-only and would silently produce no platform
// on Safari/Firefox, which this app needs to support (iOS is a primary
// target). A coarse regex against userAgent is good enough for a display
// label; it doesn't need to be precise the way a security check would.
function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/ipad|iphone|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/mac os x|macintosh/i.test(ua)) return "macos";
  if (/windows/i.test(ua)) return "windows";
  if (/linux/i.test(ua)) return "linux";
  return "device";
}

// location: the admin-set value from local_settings.deviceLocation
// (Settings > Device, e.g. "yaounde"). Undefined/empty falls back to just
// the platform -- still a meaningful, if less specific, label.
export function getDeviceLabel(location: string | undefined): string {
  const platform = detectPlatform();
  const trimmed = location?.trim();
  return trimmed ? `${platform}-${trimmed}` : platform;
}
