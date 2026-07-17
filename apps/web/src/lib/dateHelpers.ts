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
