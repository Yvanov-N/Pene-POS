// Amount helpers with no i18n dependency (unit-testable in node). Amounts are
// plain JS numbers backed by Postgres `numeric`; two decimals is the most the
// app ever shows or accepts.

// Absorbs float drift from summing decimals (0.1 + 0.2 -> 0.3).
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// A purchase line's total (quantity x unit cost), rounded to the franc:
// 12 x 83.33 = 999.96 -> 1 000. A unit cost may carry cents (a pack price
// split per unit), but what's actually paid to the supplier is whole francs.
// Purchases only -- sale lines keep their exact amounts.
export function purchaseLineTotal(quantity: number, unitCost: number): number {
  return Math.round(roundMoney(quantity * unitCost));
}

// Parses what a user typed into an amount field: "12,5", "12.5", "1 250,75",
// "-500". Spaces (incl. the non-breaking ones Intl puts in fr-FR amounts) are
// thousands separators; a single "," or "." is the decimal point. Returns NaN
// for anything else, so Yup/validation can reject it.
export function parseAmount(input: string | number): number {
  if (typeof input === "number") return input;
  const compact = input.trim().replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(compact) && !/^-?\.\d+$/.test(compact)) return Number.NaN;
  return Number(compact);
}

export function decimalPlaces(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = String(value);
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.split(".")[1]?.length ?? 0;
}
