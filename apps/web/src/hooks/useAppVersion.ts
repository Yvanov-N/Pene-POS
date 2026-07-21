import { useEffect, useState } from "react";
import type { VersionInfo } from "@/types/version";

// Independent of useAppUpdate's needRefresh-gated fetch (which only enriches
// the "update available" toast once a new service worker is detected
// waiting, and stays null until then). This fetches unconditionally on
// mount so "what version is currently running" has a real answer on first
// visit too, not just after an update transition fires.
export function useAppVersion() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/version.json?_=${Date.now()}`)
      .then((r) => (r.ok ? (r.json() as Promise<VersionInfo>) : null))
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo(null); // degrade gracefully, never throw
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { info, loading };
}
