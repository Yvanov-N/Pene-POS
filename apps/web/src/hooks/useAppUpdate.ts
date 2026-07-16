import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { VersionInfo } from "@/types/version";

const CHECK_INTERVAL_MS = 60_000;
const RELOAD_SAFETY_TIMEOUT_MS = 6_000;

export function useAppUpdate() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const intervalRef = useRef<number | null>(null);
  const prevNeedRefreshRef = useRef(false);
  const [applying, setApplying] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [info, setInfo] = useState<VersionInfo | null>(null);

  const checkForUpdate = useCallback(() => void registrationRef.current?.update(), []);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration ?? null;
      checkForUpdate();
      // onRegisteredSW can re-fire (e.g. React StrictMode) — clear any prior
      // interval before starting a new one so polling never doubles up.
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      console.error("[useAppUpdate] registration failed", error);
    },
  });

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && checkForUpdate();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkForUpdate]);

  useEffect(
    () => () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    },
    [],
  );

  useEffect(() => {
    if (needRefresh && !prevNeedRefreshRef.current) {
      // A fresh update always resurfaces the toast, even if a previous one was snoozed.
      setSnoozed(false);
      fetch(`/version.json?_=${Date.now()}`)
        .then((r) => (r.ok ? (r.json() as Promise<VersionInfo>) : null))
        .then(setInfo)
        .catch(() => setInfo(null)); // enrichment only — never blocks the update flow
    }
    prevNeedRefreshRef.current = needRefresh;
  }, [needRefresh]);

  const applyUpdate = useCallback(() => {
    setApplying(true);
    // Safety net: if the SW swap silently fails, force a reload anyway.
    window.setTimeout(() => window.location.reload(), RELOAD_SAFETY_TIMEOUT_MS);
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  return {
    available: needRefresh,
    info,
    applying,
    snoozed,
    applyUpdate,
    snooze: () => setSnoozed(true),
    reopen: () => setSnoozed(false),
  };
}
