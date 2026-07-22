import { useTranslation } from "react-i18next";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const BUTTON_CLASS =
  "rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-40";

// Shared "‹ Page X of Y ›" widget -- ProductsPage, StudentWalletsPage, and
// SalesHistoryPage all need the exact same one.
export function PaginationControls({ page, totalPages, onPageChange }: PaginationControlsProps) {
  const { t } = useTranslation();

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
      <span className="text-xs text-muted">{t("admin.pagination.pageOf", { page, totalPages })}</span>
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
