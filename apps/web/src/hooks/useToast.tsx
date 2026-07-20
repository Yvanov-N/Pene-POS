import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastContainer, type ToastAction, type ToastRecord, type ToastVariant } from "@/components/ui/toast-container";

export type { ToastVariant, ToastAction };

const DEFAULT_DURATION_MS = 3000;

interface ToastContextValue {
  showToast: (variant: ToastVariant, message: string, durationMs?: number, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (variant: ToastVariant, message: string, durationMs = DEFAULT_DURATION_MS, action?: ToastAction) => {
      nextIdRef.current += 1;
      const id = `toast-${nextIdRef.current}`;
      setToasts((current) => [...current, { id, variant, message, durationMs, action }]);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
