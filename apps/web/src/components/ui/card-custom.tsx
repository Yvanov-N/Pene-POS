import type { ReactNode } from "react";

interface CardCustomProps {
  title?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CardCustom({ title, header, footer, children, className }: CardCustomProps) {
  return (
    <div className={`card${className ? ` ${className}` : ""}`}>
      {(title || header) && (
        // flex-wrap: on a phone the header buttons drop below the title instead of
        // overflowing the card.
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
          {header}
        </div>
      )}
      {children}
      {footer && <div className="mt-4 border-t border-border pt-4">{footer}</div>}
    </div>
  );
}
