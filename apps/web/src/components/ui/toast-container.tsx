import { useEffect, useState } from "react";

export type ToastVariant = "success" | "error" | "warning";

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
};

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠️",
};

// Exit is animated in JS (not pure CSS) because unmounting removes the DOM
// node immediately -- React won't wait for a CSS transition to finish on its
// own. Flipping `visible` off first, then removing the record from state
// after the transition duration, is what makes the fade-out actually visible.
const EXIT_ANIMATION_MS = 200;

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const dismissTimeout = window.setTimeout(() => setVisible(false), toast.durationMs);
    return () => window.clearTimeout(dismissTimeout);
  }, [toast.durationMs]);

  useEffect(() => {
    if (visible) return;
    const removeTimeout = window.setTimeout(() => onDismiss(toast.id), EXIT_ANIMATION_MS);
    return () => window.clearTimeout(removeTimeout);
  }, [visible, toast.id, onDismiss]);

  return (
    <div
      role="status"
      className={`${VARIANT_CLASSES[toast.variant]} flex items-center gap-2 text-sm transition-all duration-200 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0"
      }`}
    >
      <span aria-hidden>{VARIANT_ICON[toast.variant]}</span>
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            setVisible(false);
          }}
          className="shrink-0 whitespace-nowrap rounded-md border border-current px-2 py-1 text-xs font-semibold text-current hover:bg-current/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="×"
        className="text-current opacity-70 hover:opacity-100"
      >
        ×
      </button>
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
