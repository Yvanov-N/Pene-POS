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

// A Date's local calendar day as YYYY-MM-DD -- the value format of an
// <input type="date">. Not toISOString().slice(0, 10), which is the UTC day
// and lands on the wrong date near midnight for any shop off UTC.
export function toLocalDateInput(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
//
// A window still in progress (today, last 7/30 days, a custom range reaching
// today) is compared against the previous period cut at the same elapsed
// time -- today until 10:00 vs yesterday until 10:00, not vs all of
// yesterday, which would read as a steep drop every morning. `now` is a
// parameter so callers can re-evaluate it as time passes (and tests can pin it).
export function getRangeForFilter(filter: TimeRangeFilter, customRange?: CustomRange, now: Date = new Date()): RangeWithPrevious {
  let start: Date;
  let end: Date;

  if (filter === "yesterday") {
    const day = addDays(now, -1);
    start = startOfDay(day);
    end = endOfDay(day);
  } else if (filter === "last7days" || filter === "last30days") {
    const days = filter === "last7days" ? 7 : 30;
    start = startOfDay(addDays(now, -(days - 1)));
    end = endOfDay(now);
  } else if (filter === "custom" && customRange) {
    // Picked in either order -- an end before the start would otherwise be an
    // empty range that silently shows all zeros.
    const [from, to] = [customRange.start, customRange.end].sort();
    start = startOfDay(new Date(`${from}T00:00:00`));
    end = endOfDay(new Date(`${to}T00:00:00`));
  } else {
    // "today", or "custom" before the admin has actually picked both dates yet
    // -- falls back to today rather than throwing, so the dashboard always has
    // something valid to render while the date pickers are still empty.
    start = startOfDay(now);
    end = endOfDay(now);
  }

  // Calendar days covered, both ends inclusive (rounded: a DST change makes
  // one day 23h or 25h long).
  const spanDays = Math.round((startOfDay(end).getTime() - start.getTime()) / DAY_MS) + 1;
  const inProgress = start <= now && now <= end;
  const prevStart = startOfDay(addDays(start, -spanDays));
  const prevEnd = inProgress ? addDays(now, -spanDays) : endOfDay(addDays(start, -1));

  return {
    current: { start: start.toISOString(), end: end.toISOString() },
    previous: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
  };
}
