import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { SortDir } from "@/lib/sorting";

interface SortableThProps<K extends string> {
  label: string;
  column: K;
  sortKey: K;
  sortDir: SortDir;
  onSort: (column: K) => void;
  align?: "left" | "right";
  className?: string;
}

// A clickable table header: the faint double arrow says "sortable", the
// single arrow shows the active column and its direction.
export function SortableTh<K extends string>({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  align = "left",
  className = "",
}: SortableThProps<K>) {
  const active = column === sortKey;
  const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ChevronUp : ChevronDown;

  return (
    <th
      className={`py-2 pr-3 ${align === "right" ? "text-right" : ""} ${className}`}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${
          active ? "text-foreground" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <Icon className={`h-3 w-3 shrink-0 ${active ? "" : "opacity-40"}`} aria-hidden />
      </button>
    </th>
  );
}
