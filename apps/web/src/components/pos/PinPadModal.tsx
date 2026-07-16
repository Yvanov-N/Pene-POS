import { useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/hashPin";
import type { Profile } from "@/types/db";
import type { UserRole } from "@/types/supabase";

const PIN_LENGTH = 4;
const SHAKE_DURATION_MS = 400;
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

interface PinPadModalProps {
  title: string;
  onSuccess: (profile: Profile) => void;
  onClose: () => void;
  // When set, only a profile with this exact role can match -- a correct
  // PIN belonging to a profile of the wrong role is treated the same as an
  // incorrect PIN (never reveal "valid PIN, wrong role").
  requiredRole?: UserRole;
}

export function PinPadModal({ title, onSuccess, onClose, requiredRole }: PinPadModalProps) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState("");
  const [shake, setShake] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const verify = async (candidate: string) => {
    setChecking(true);
    const allowedRoles = requiredRole ? [requiredRole] : (["admin", "cashier"] as const);
    const candidates = await db.profiles.where("role").anyOf(allowedRoles).toArray();
    const candidateHash = await hashPin(candidate);
    const match = candidates.find((profile) => profile.pin_hash === candidateHash);
    setChecking(false);

    if (match) {
      setErrorMessage(null);
      onSuccess(match);
      return;
    }

    setErrorMessage(t("pos.pin.incorrect"));
    setShake(true);
    setDigits("");
    window.setTimeout(() => setShake(false), SHAKE_DURATION_MS);
  };

  const handleKeyPress = (key: string) => {
    if (checking) return;

    if (key === "back") {
      setDigits((current) => current.slice(0, -1));
      return;
    }
    if (key === "" || digits.length >= PIN_LENGTH) return;

    const next = digits + key;
    setDigits(next);
    if (next.length === PIN_LENGTH) {
      void verify(next);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            ✕
          </button>
        </div>

        <div className={`pin-dots mb-2 ${shake ? "shake" : ""}`}>
          {Array.from({ length: PIN_LENGTH }).map((_, index) => (
            <span key={index} className={`pin-dot ${index < digits.length ? "filled" : ""}`} />
          ))}
        </div>

        <p className="mb-4 h-4 text-center text-xs text-destructive">{errorMessage}</p>

        <div className="pin-pad">
          {PAD_KEYS.map((key, index) => {
            if (key === "") return <span key={`blank-${index}`} />;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleKeyPress(key)}
                disabled={checking}
                className="rounded-lg border border-border bg-surface2 py-3 text-lg font-medium text-foreground transition-colors hover:border-accent disabled:opacity-50"
              >
                {key === "back" ? "⌫" : key}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
