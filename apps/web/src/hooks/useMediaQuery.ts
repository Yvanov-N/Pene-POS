import { useSyncExternalStore } from "react";

// useSyncExternalStore (not useState+useEffect) so this reads correctly on
// the very first render instead of always starting from a stale default and
// flashing the wrong layout for one frame -- matters here specifically
// because PosLayout uses this to decide which of two entirely different
// cart components to mount, not just a CSS class to toggle.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
