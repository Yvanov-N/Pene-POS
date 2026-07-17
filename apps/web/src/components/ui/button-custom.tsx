import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PinPadModal } from "@/components/pos/PinPadModal";
import type { Profile } from "@/types/db";

export type ButtonVariant = "primary" | "success" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

interface ButtonCustomProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  // When set, onClick is deferred until an admin PIN is verified via the
  // existing PinPadModal -- always re-prompts (no "already admin session"
  // shortcut), matching the app's one existing convention for admin-gated
  // actions (SidebarNav.tsx).
  requiresAdminPin?: boolean;
  pinModalTitle?: string;
  // The matched Profile is only ever populated when requiresAdminPin
  // actually gated this click -- PinPadModal already resolves it during
  // verification, so passing it through here is what lets an action record
  // *which* admin authorized it (e.g. refundService.voidSale's adminId)
  // instead of silently discarding that information. Non-gated callers can
  // just ignore the parameter.
  onClick?: (profile?: Profile) => void | Promise<void>;
  children?: ReactNode;
}

function cn(...classes: Array<string | false | undefined | null>): string {
  return classes.filter(Boolean).join(" ");
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-2",
  success: "bg-success text-success-foreground hover:opacity-90",
  danger: "bg-destructive text-destructive-foreground hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs font-medium",
  md: "px-4 py-2 text-sm font-semibold",
  lg: "px-6 py-3 text-base font-semibold",
  icon: "h-8 w-8 p-0 text-sm",
};

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function ButtonCustom({
  variant = "primary",
  size = "md",
  isLoading = false,
  requiresAdminPin = false,
  pinModalTitle,
  onClick,
  disabled,
  className,
  children,
  ...rest
}: ButtonCustomProps) {
  const { t } = useTranslation();
  const [showPinPad, setShowPinPad] = useState(false);

  const runClick = (profile?: Profile) => {
    if (onClick) void onClick(profile);
  };

  const handleClick = () => {
    if (requiresAdminPin) {
      setShowPinPad(true);
      return;
    }
    runClick();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-40",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...rest}
      >
        {isLoading ? <Spinner /> : children}
      </button>

      {showPinPad && (
        <PinPadModal
          title={pinModalTitle ?? t("admin.nav.pinTitle")}
          requiredRole="admin"
          onSuccess={(profile) => {
            setShowPinPad(false);
            runClick(profile);
          }}
          onClose={() => setShowPinPad(false)}
        />
      )}
    </>
  );
}
