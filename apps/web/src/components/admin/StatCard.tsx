import { useEffect, useRef, useState, type ReactNode } from "react";

const TWEEN_DURATION_MS = 400;

// lucide-react isn't installed in this project (confirmed absent, same as
// every other icon in the app -- plain emoji, no icon library). `icon`
// accepts any ReactNode so a real icon component can be dropped in later
// without changing this component's API.
interface StatCardProps {
  label: string;
  value: number;
  formatValue?: (value: number) => string;
  sub?: ReactNode;
  icon?: ReactNode;
  // Appended to the root .stat-card div -- e.g. a debt KPI spanning the full
  // grid width to read as visually distinct from the revenue-style cards
  // beside it, rather than just another same-shaped tile.
  className?: string;
  // Overrides .stat-value's default color (e.g. red for a debt total) --
  // appended, not replacing, so stat-value's size/weight are always kept.
  valueClassName?: string;
}

function defaultFormatValue(value: number): string {
  return Math.round(value).toLocaleString();
}

// Smoothly tweens the displayed number toward `target` whenever it changes,
// rather than snapping instantly -- a checkout completing mid-glance should
// read as the total ticking up, not a jarring number swap.
function useAnimatedNumber(target: number): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / TWEEN_DURATION_MS);
      setDisplay(from + (to - from) * progress);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return display;
}

export function StatCard({
  label,
  value,
  formatValue = defaultFormatValue,
  sub,
  icon,
  className,
  valueClassName,
}: StatCardProps) {
  const animatedValue = useAnimatedNumber(value);

  return (
    <div className={`stat-card${className ? ` ${className}` : ""}`}>
      {icon && (
        <span className="absolute right-4 top-4 text-xl opacity-70" aria-hidden>
          {icon}
        </span>
      )}
      <p className="stat-label">{label}</p>
      <p className={`stat-value mt-1${valueClassName ? ` ${valueClassName}` : ""}`}>{formatValue(animatedValue)}</p>
      {sub && <p className="stat-sub mt-1">{sub}</p>}
    </div>
  );
}
