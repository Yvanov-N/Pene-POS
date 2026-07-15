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

  const categories = useLiveQuery(async () => {
    const products = await db.products.toArray();
    const unique = new Set(
      products.map((product) => product.category).filter((category): category is string => Boolean(category)),
    );
    return [ALL_CATEGORIES_VALUE, ...Array.from(unique).sort()];
  }, []);

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
        {(categories ?? [ALL_CATEGORIES_VALUE]).map((category) => {
          const isActive = category === activeCategory;
          const label = category === ALL_CATEGORIES_VALUE ? t("pos.filters.allCategory") : category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => onCategoryChange(category)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface2 text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
