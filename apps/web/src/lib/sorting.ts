export type SortDir = "asc" | "desc";

type Sortable = string | number | boolean | null | undefined;

// French-aware text order ("Eau" < "étudiant" < "Fromage", "Item 2" < "Item 10").
const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

// Compares two cell values for a table sort. Empty values (null, undefined,
// "") always go last whatever the direction -- a column sorted by purchase
// price shouldn't open on a wall of "—".
export function compareValues(a: Sortable, b: Sortable, dir: SortDir): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "string" && typeof b === "string") return collator.compare(a, b) * sign;
  return (Number(a) - Number(b)) * sign;
}

// Stable sort of `rows` by the value `get` reads for the active column.
export function sortRows<T>(rows: T[], get: (row: T) => Sortable, dir: SortDir): T[] {
  return [...rows].sort((a, b) => compareValues(get(a), get(b), dir));
}
