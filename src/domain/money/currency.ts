import type { Money } from "./provenance";
export const currencyMetadata = {
  EUR: { symbol: "€", minorUnits: 2 },
  GBP: { symbol: "£", minorUnits: 2 },
  USD: { symbol: "$", minorUnits: 2 },
  CHF: { symbol: "CHF", minorUnits: 2 },
} as const;
export type CurrencyCode = keyof typeof currencyMetadata;
export const supportedCurrencies = Object.keys(
  currencyMetadata,
) as CurrencyCode[];
export function isCurrency(value: unknown): value is CurrencyCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(currencyMetadata, value)
  );
}
export type MoneyAmount = { cents: number; currency: CurrencyCode };
export type MoneyDelta = MoneyAmount;
/** `cents` is the legacy field name for integer minor units, not an implied currency. */
export function money(
  cents: number,
  currency: CurrencyCode = "EUR",
): MoneyAmount {
  if (!isCurrency(currency) || !Number.isSafeInteger(cents) || cents < 0)
    throw new RangeError("Invalid money amount or currency");
  return { cents, currency };
}
export function assertCurrency(amount: MoneyAmount, currency: CurrencyCode) {
  money(amount.cents, amount.currency);
  if (amount.currency !== currency) throw new RangeError("Currency mismatch");
}
export function majorUnits(amount: MoneyAmount): string {
  const scale = 10 ** currencyMetadata[amount.currency].minorUnits;
  return String(amount.cents / scale);
}
export function parseMoney(
  raw: string,
  currency: CurrencyCode,
): MoneyAmount | undefined {
  if (!isCurrency(currency)) return;
  const decimals = currencyMetadata[currency].minorUnits;
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(raw)) return;
  const [whole, fraction = ""] = raw.split(".");
  const cents =
    Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0"));
  return Number.isSafeInteger(cents) && cents >= 0
    ? money(cents, currency)
    : undefined;
}
export function parsePlanningBudget(
  raw: string | undefined,
  currency: CurrencyCode,
) {
  if (!isCurrency(currency)) return;
  const amount = raw === undefined ? undefined : parseMoney(raw, currency);
  const scale = 10 ** currencyMetadata[currency].minorUnits;
  return amount && amount.cents >= scale && amount.cents <= 100000 * scale
    ? amount
    : undefined;
}
/** Pin EN/SQ formats to avoid ICU differences between browser and server. Supports signed deltas.
 * Takes Money only: every displayed amount must say where it came from (./provenance). */
export function formatMoney(amount: Money, locale: "en" | "sq") {
  const { currency, cents } = amount;
  if (!isCurrency(currency) || !Number.isSafeInteger(cents))
    throw new RangeError("Invalid money format");
  const { symbol, minorUnits } = currencyMetadata[currency];
  const scale = 10 ** minorUnits,
    absolute = Math.abs(cents);
  const integer = String(Math.floor(absolute / scale)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    locale === "sq" ? "\u00a0" : ",",
  );
  const fraction =
    absolute % scale
      ? `${locale === "sq" ? "," : "."}${String(absolute % scale).padStart(minorUnits, "0")}`
      : "";
  const number = integer + fraction;
  return `${cents < 0 ? "-" : ""}${locale === "sq" ? `${number}\u00a0${symbol}` : `${symbol}${symbol.length > 1 ? " " : ""}${number}`}`;
}
