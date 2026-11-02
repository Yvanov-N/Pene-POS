// Amount helpers with no i18n dependency (unit-testable in node). Amounts are
// plain JS numbers backed by Postgres `numeric`; two decimals is the most the
// app ever shows or accepts.

// Absorbs float drift from summing decimals (0.1 + 0.2 -> 0.3).
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
