import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export type NavigationTarget = "products" | "students" | "settings";

interface NavigationDrawerProps {
  onClose: () => void;
  onNavigate: (target: NavigationTarget) => void;
}

const NAV_ITEMS = [
  { target: "products", icon: "📦", labelKey: "admin.nav.products" },
  { target: "students", icon: "🎓", labelKey: "admin.nav.students" },
  { target: "settings", icon: "⚙️", labelKey: "admin.nav.settings" },
] as const satisfies { target: NavigationTarget; icon: string; labelKey: string }[];

export function NavigationDrawer({ onClose, onNavigate }: NavigationDrawerProps) {
  const { t } = useTranslation();
  // Mount closed, then slide open on the next frame -- a plain instant
  // appear/disappear doesn't read as a "drawer" the way a slide-in does,
  // unlike the app's other (centered) admin modals where that distinction
  // doesn't matter.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div
        className={`flex h-full w-[85%] max-w-xs flex-col gap-1 border-r border-border bg-surface p-4 transition-transform duration-200 ease-out sm:max-w-sm ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t("admin.nav.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ target, icon, labelKey }) => (
            <button
              key={target}
              type="button"
              onClick={() => onNavigate(target)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-surface2"
            >
              <span aria-hidden>{icon}</span>
              {t(labelKey)}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
