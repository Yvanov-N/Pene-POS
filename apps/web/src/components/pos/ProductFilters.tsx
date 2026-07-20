import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { db } from "@/lib/db";
import { ALL_CATEGORIES_VALUE } from "@/lib/constants";

interface ProductFiltersProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}

export function ProductFilters({
  searchTerm,
  onSearchChange,
  activeCategory,
  onCategoryChange,
}: ProductFiltersProps) {
  const { t } = useTranslation();

  const categories = useLiveQuery(() => db.categories.orderBy("name").toArray(), []);
  const pillOptions = [{ id: ALL_CATEGORIES_VALUE, name: t("pos.filters.allCategory") }, ...(categories ?? [])];

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={searchTerm}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={t("pos.filters.searchPlaceholder")}
        className="w-full rounded-lg border border-border bg-surface2 px-4 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {pillOptions.map((option) => {
          const isActive = option.id === activeCategory;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onCategoryChange(option.id)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface2 text-muted hover:text-foreground"
              }`}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
