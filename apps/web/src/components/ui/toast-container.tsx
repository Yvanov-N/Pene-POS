import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, AlertTriangle, Info, X, type LucideIcon } from "lucide-react";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastRecord {
  id: string;
  variant: ToastVariant;
  message: string;
  durationMs: number;
  action?: ToastAction;
}

interface ToastContainerProps {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "toast-success",
  error: "toast-error",
  warning: "toast-warning",
  info: "toast-info",
};

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

// Exit is animated in JS (not pure CSS) because unmounting removes the DOM
// node immediately -- React won't wait for a CSS transition to finish on its
// own. Flipping `visible` off first, then removing the record from state
// after the transition duration, is what makes the fade-out actually visible.
const EXIT_ANIMATION_MS = 200;

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);

  // The auto-dismiss timer needs to genuinely pause (not just visually) --
  // a cashier reading a toast mid-rush shouldn't have it vanish under their
  // cursor. setTimeout can't pause itself, so remainingRef tracks how much
  // time is left and startedAtRef marks when the current running phase
  // began; pausing subtracts the elapsed time from what's left, resuming
  // reschedules a fresh setTimeout for exactly that much.
  const remainingRef = useRef(toast.durationMs);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (paused) {
      if (startedAtRef.current !== null) {
        remainingRef.current -= Date.now() - startedAtRef.current;
        startedAtRef.current = null;
      }
      return;
    }
    startedAtRef.current = Date.now();
    const dismissTimeout = window.setTimeout(() => setVisible(false), remainingRef.current);
    return () => window.clearTimeout(dismissTimeout);
  }, [paused]);

  useEffect(() => {
    if (visible) return;
    const removeTimeout = window.setTimeout(() => onDismiss(toast.id), EXIT_ANIMATION_MS);
    return () => window.clearTimeout(removeTimeout);
  }, [visible, toast.id, onDismiss]);

  const pause = () => setPaused(true);
  const resume = () => setPaused(false);
  const Icon = VARIANT_ICON[toast.variant];

  return (
    <div
      role="status"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onTouchStart={pause}
      onTouchEnd={resume}
      onTouchCancel={resume}
      className={`${VARIANT_CLASSES[toast.variant]} transition-all duration-200 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0"
      }`}
    >
      <div className="flex items-center gap-2 text-sm">
        <Icon className="toast-icon h-5 w-5 shrink-0" aria-hidden />
        <span className="flex-1">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              setVisible(false);
            }}
            className="toast-icon shrink-0 whitespace-nowrap rounded-md border-2 border-current px-2.5 py-1 text-xs font-bold hover:bg-current/10"
          >
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label={t("pos.pin.close")}
          className="shrink-0 text-current opacity-60 hover:opacity-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="toast-progress-track">
        <div
          className="toast-progress-bar"
          style={{
            animationDuration: `${toast.durationMs}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      </div>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
