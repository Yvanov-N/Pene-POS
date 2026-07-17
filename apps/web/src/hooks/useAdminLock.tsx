import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";
import { useToast } from "./useToast";

const INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000;

// "pos:barcode-scan" is dispatched by useBarcodeScanner on every successful
// scan -- a scan is real cashier activity even though it never touches the
// mouse/keyboard/touch surface this listens to otherwise.
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "pos:barcode-scan"] as const;

interface AdminLockContextValue {
  isAdminUnlocked: boolean;
  // Self-contained verify-and-unlock (hashes + checks against local Dexie
  // profiles directly) -- usable by any future admin-only entry point that
  // doesn't already go through PinPadModal.
  unlockWithPin: (pin: string) => Promise<boolean>;
  // For callers where verification already happened elsewhere (TopBar's
  // click-interception reuses the existing PinPadModal, which does its own
  // hash+lookup internally and only ever reports success for a matching
  // admin profile) -- this just records that outcome.
  unlock: () => void;
  manualLock: () => void;
}

const AdminLockContext = createContext<AdminLockContextValue | null>(null);

export function AdminLockProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const manualLock = useCallback(() => setIsAdminUnlocked(false), []);
  const unlock = useCallback(() => setIsAdminUnlocked(true), []);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const admins = await db.profiles.where("role").equals("admin").toArray();
    const candidateHash = await hashPin(pin);
    const match = admins.find((profile) => profile.pin_hash === candidateHash);
    if (!match) return false;
    setIsAdminUnlocked(true);
    return true;
  }, []);

  // The timer only runs while unlocked -- there's nothing to auto-lock
  // otherwise, and re-arming it on every activity event while locked would
  // be pure waste.
  useEffect(() => {
    if (!isAdminUnlocked) return;

    const resetTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setIsAdminUnlocked(false);
        showToast("error", t("admin.lock.autoLockedToast"));
      }, INACTIVITY_TIMEOUT_MS);
    };

    resetTimer();
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, resetTimer);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, resetTimer);
      }
    };
  }, [isAdminUnlocked, showToast, t]);

  const value: AdminLockContextValue = { isAdminUnlocked, unlockWithPin, unlock, manualLock };

  return <AdminLockContext.Provider value={value}>{children}</AdminLockContext.Provider>;
}

export function useAdminLock(): AdminLockContextValue {
  const context = useContext(AdminLockContext);
  if (!context) {
    throw new Error("useAdminLock must be used within an AdminLockProvider");
  }
  return context;
}
