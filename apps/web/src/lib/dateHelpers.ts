export interface DateRange {
  start: string;
  end: string;
}

// "Today" for a cashier/admin means their own local calendar day, but
// created_at is stored as a UTC ISO string (`new Date().toISOString()`, see
// PosCart.tsx's completeCheckout). Constructing the boundary Dates via the
// local-timezone constructor and then calling .toISOString() converts "local
// midnight" into its UTC equivalent -- exactly what's needed to bound a
// simple lexicographic range comparison against those UTC-stored strings
// (ISO 8601 UTC strings sort chronologically as plain strings, so no date
// parsing is needed on the query side). Using UTC calendar boundaries
// instead would silently shift "today" by the local UTC offset -- wrong for
// any shop not sitting exactly on UTC.
export function getTodayTimeRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type TimeRangeFilter = "today" | "yesterday" | "last7days" | "last30days" | "custom";

export interface CustomRange {
  start: string;
  end: string;
}

export interface RangeWithPrevious {
  current: DateRange;
  previous: DateRange;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Same local-calendar-boundary reasoning as getTodayTimeRange() above,
// generalized to a selectable window plus its "previous equivalent period"
// (same span, immediately preceding) for percentage-change comparisons.
export function getRangeForFilter(filter: TimeRangeFilter, customRange?: CustomRange): RangeWithPrevious {
  const now = new Date();

  if (filter === "yesterday") {
    const day = addDays(now, -1);
    const dayBefore = addDays(day, -1);
    return {
      current: { start: startOfDay(day).toISOString(), end: endOfDay(day).toISOString() },
      previous: { start: startOfDay(dayBefore).toISOString(), end: endOfDay(dayBefore).toISOString() },
    };
  }

  if (filter === "last7days" || filter === "last30days") {
    const days = filter === "last7days" ? 7 : 30;
    const end = endOfDay(now);
    const start = startOfDay(addDays(now, -(days - 1)));

    const prevEnd = endOfDay(addDays(start, -1));
    const prevStart = startOfDay(addDays(prevEnd, -(days - 1)));
    return {
      current: { start: start.toISOString(), end: end.toISOString() },
      previous: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
    };
  }

  if (filter === "custom" && customRange) {
    const start = startOfDay(new Date(`${customRange.start}T00:00:00`));
    const end = endOfDay(new Date(`${customRange.end}T00:00:00`));
    const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);

    const prevEnd = endOfDay(addDays(start, -1));
    const prevStart = startOfDay(addDays(prevEnd, -(spanDays - 1)));
    return {
      current: { start: start.toISOString(), end: end.toISOString() },
      previous: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
    };
  }

  // "today", or "custom" before the admin has actually picked both dates yet
  // -- falls back to today rather than throwing, so the dashboard always has
  // something valid to render while the date pickers are still empty.
  const day = now;
  const dayBefore = addDays(day, -1);
  return {
    current: { start: startOfDay(day).toISOString(), end: endOfDay(day).toISOString() },
    previous: { start: startOfDay(dayBefore).toISOString(), end: endOfDay(dayBefore).toISOString() },
  };
}
