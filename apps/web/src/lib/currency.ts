import i18n from "@/i18n";

const CURRENCY = "XAF";
const LOCALE_BY_LANGUAGE: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
};

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(language: string): Intl.NumberFormat {
  const locale = LOCALE_BY_LANGUAGE[language] ?? LOCALE_BY_LANGUAGE.fr;
  let formatter = formatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: CURRENCY,
      maximumFractionDigits: 0,
    });
    formatterCache.set(locale, formatter);
  }
  return formatter;
}

export function formatCurrency(amount: number): string {
  return getFormatter(i18n.language).format(amount);
}
