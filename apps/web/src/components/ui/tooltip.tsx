import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  // Only "right" is needed today (the collapsed sidebar rail), but the
  // side is still a prop rather than hardcoded so a future caller isn't
  // stuck re-deriving this component's positioning math from scratch.
  side?: "right" | "top";
  className?: string;
}

interface Coords {
  top: number;
  left: number;
}

// Plain hand-rolled tooltip (no Radix/Headless UI anywhere in this project --
// switch.tsx documents the same choice) rather than @radix-ui/react-tooltip.
// It still needs a portal + getBoundingClientRect-based fixed positioning
// (not a simple CSS group-hover absolute span) because its one real caller
// is the collapsed sidebar rail, and that rail has `overflow-y-auto` for its
// own scrolling nav list -- any child positioned absolute relative to an
// ancestor inside that rail gets silently clipped the moment it overflows
// past the rail's own (64px-wide) edge, which is exactly what a right-side
// tooltip does by design. Rendering into document.body sidesteps that
// entirely without touching the rail's own overflow behavior.
export function Tooltip({ label, children, side = "right", className }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords(
      side === "right"
        ? { top: rect.top + rect.height / 2, left: rect.right + 8 }
        : { top: rect.top - 8, left: rect.left + rect.width / 2 },
    );
  };
  const hide = () => setCoords(null);

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className ?? ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[999] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
            style={{
              top: coords.top,
              left: coords.left,
              transform: side === "right" ? "translateY(-50%)" : "translate(-50%, -100%)",
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

// Only wraps in the actual Tooltip when `show` is true (e.g. a nav rail
// collapsed to icon-only) -- when false, this must render `children`
// completely unwrapped rather than a Tooltip with its floating label simply
// hidden, since Tooltip's wrapper span would otherwise sit between a flex
// parent and content that relies on being a direct flex child (e.g. a
// `flex-1` NavLink).
export function ConditionalTooltip({
  show,
  label,
  children,
  side,
}: TooltipProps & { show: boolean }) {
  if (!show) return <>{children}</>;
  return (
    <Tooltip label={label} side={side}>
      {children}
    </Tooltip>
  );
}
