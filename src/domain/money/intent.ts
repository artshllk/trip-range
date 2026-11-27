import { parseMoney, type CurrencyCode, type MoneyAmount } from "./currency";
const tokenCurrency: Record<string, CurrencyCode> = {
  "€": "EUR",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  "£": "GBP",
  gbp: "GBP",
  pounds: "GBP",
  $: "USD",
  usd: "USD",
  dollars: "USD",
  chf: "CHF",
};
export type MoneyIntent =
  | { status: "none" }
  | { status: "ambiguous" }
  | { status: "explicit"; amount: MoneyAmount };
/** An unqualified $ means USD in this four-currency product; CAD/AUD are not inferred. */
export function readMoneyIntent(text: string): MoneyIntent {
  if (/\b(?:CAD|AUD|AED|JPY)\b|(?:CA|AU)\$/i.test(text))
    return { status: "ambiguous" };
  const pattern =
    /(?:([€£$]|EUR|GBP|USD|CHF)\s*(\d+(?:[.,]\d+)*))|(?:(\d+(?:[.,]\d+)*)\s*(EUR|euros?|GBP|pounds|USD|dollars|CHF)\b)/gi;
  const matches = [...text.matchAll(pattern)];
  const amounts = matches.flatMap((match) => {
    const currency = tokenCurrency[(match[1] ?? match[4]).toLowerCase()];
    const amount = parseMoney(
      (match[2] ?? match[3]).replace(",", "."),
      currency,
    );
    return amount ? [amount] : [];
  });
  if (amounts.length !== matches.length) return { status: "ambiguous" };
  if (!amounts.length) return { status: "none" };
  return amounts.some(
    (a) => a.currency !== amounts[0].currency || a.cents !== amounts[0].cents,
  )
    ? { status: "ambiguous" }
    : { status: "explicit", amount: amounts[0] };
}
