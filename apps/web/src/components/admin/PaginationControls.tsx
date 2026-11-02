import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { clampPage } from "@/lib/pagination";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const BUTTON_CLASS =
  "rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-40";

// Shared "‹ Page [x] of Y ›" widget -- ProductsPage, StudentWalletsPage, and
// SalesHistoryPage all need the exact same one. The page number is editable
// so a long history can be jumped through directly.
export function PaginationControls({ page, totalPages, onPageChange }: PaginationControlsProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(page));

  // Previous/next (or a filter change resetting to page 1) moves the page
  // from outside -- keep the box in step.
  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  const commit = () => {
    const next = clampPage(draft, page, totalPages);
    setDraft(String(next));
    if (next !== page) onPageChange(next);
  };

  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={BUTTON_CLASS}
      >
        {t("admin.pagination.previous")}
      </button>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {t("admin.pagination.pageLabel")}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.max(1, totalPages)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          aria-label={t("admin.pagination.goTo")}
          className="w-14 rounded-lg border border-border bg-surface2 px-2 py-1 text-center text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-accent"
        />
        {t("admin.pagination.ofTotal", { totalPages: Math.max(1, totalPages) })}
      </label>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={BUTTON_CLASS}
      >
        {t("admin.pagination.next")}
      </button>
    </div>
  );
}
