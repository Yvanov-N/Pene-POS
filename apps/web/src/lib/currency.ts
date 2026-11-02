import i18n from "@/i18n";
import { roundMoney } from "@/lib/money";

const CURRENCY = "XAF";
const LOCALE_BY_LANGUAGE: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
};

const formatterCache = new Map<string, Intl.NumberFormat>();

// Two formatters per locale: whole amounts stay "1 250 FCFA" (the common
// case), anything with cents shows exactly two decimals ("12,50 FCFA").
function getFormatter(language: string, withDecimals: boolean): Intl.NumberFormat {
  const locale = LOCALE_BY_LANGUAGE[language] ?? LOCALE_BY_LANGUAGE.fr;
  const key = `${locale}:${withDecimals ? 2 : 0}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: CURRENCY,
      minimumFractionDigits: withDecimals ? 2 : 0,
      maximumFractionDigits: withDecimals ? 2 : 0,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatCurrency(amount: number): string {
  const rounded = roundMoney(amount);
  return getFormatter(i18n.language, !Number.isInteger(rounded)).format(rounded);
}
