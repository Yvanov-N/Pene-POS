import { useEffect, useState } from "react";

// Generic value debounce -- used by usePaginatedQuery so free-text search
// doesn't fire a server request per keystroke, while page/sort/filter
// changes (which don't go through this) stay instant.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
