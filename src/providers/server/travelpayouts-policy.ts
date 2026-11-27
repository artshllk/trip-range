import { isCurrency, type CurrencyCode } from "../../domain/money/currency";
/** Reviewed cache partition for the current aviasales.com handoff; not a country/currency guess. */
export const travelpayoutsMarket = {
  code: "us",
  reason: "aviasales-com-default",
} as const;
export type ProviderCurrencyResult =
  | { status: "match" }
  | { status: "mismatch" | "unconfirmed" };
export function providerCurrency(
  requested: CurrencyCode,
  evidence: unknown[],
  /** Opt in only for prices_for_dates’ documented request-currency contract. */
  endpointCurrency?: CurrencyCode,
): ProviderCurrencyResult {
  const declared = evidence.filter((c) => c !== undefined);
  if (
    declared.some((c) => typeof c !== "string" || c.toUpperCase() !== requested)
  )
    return { status: "mismatch" };
  // Never use a default currency. Missing echoes are valid only for the documented
  // endpoint contract and the supported currency explicitly sent in that request.
  return declared.length ||
    (isCurrency(endpointCurrency) && endpointCurrency === requested)
    ? { status: "match" }
    : { status: "unconfirmed" };
}
