// Shared by the restocking/supplier screens -- same input look as the rest
// of the admin forms (RestockingPage, CategoryManagerModal...).
export const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent";

export const PILL_CLASS = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface2 text-muted hover:text-foreground"
  }`;

export const SMALL_BUTTON_CLASS =
  "rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50";
