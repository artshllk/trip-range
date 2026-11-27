import type { TravelLocation } from "../types";
import type { CurrencyCode } from "../money/currency";
export type MarketProfile = {
  originId: string;
  countryCode: string;
  cityCode?: string;
  planningCurrency: CurrencyCode;
  seoStatus: "none" | "candidate" | "approved";
  seoCurrency?: CurrencyCode;
  nearbyAirportGroup?: "balkan-eur";
};
export const marketProfiles: readonly MarketProfile[] = [
  {
    originId: "tirana",
    cityCode: "TIA",
    countryCode: "AL",
    planningCurrency: "EUR",
    seoStatus: "approved",
    nearbyAirportGroup: "balkan-eur",
  },
  {
    originId: "zurich",
    cityCode: "ZRH",
    countryCode: "CH",
    planningCurrency: "CHF",
    seoStatus: "approved",
    seoCurrency: "EUR",
  },
  {
    originId: "london",
    cityCode: "LON",
    countryCode: "GB",
    planningCurrency: "GBP",
    seoStatus: "candidate",
  },
  {
    originId: "manchester",
    cityCode: "MAN",
    countryCode: "GB",
    planningCurrency: "GBP",
    seoStatus: "candidate",
  },
  {
    originId: "dublin",
    cityCode: "DUB",
    countryCode: "IE",
    planningCurrency: "EUR",
    seoStatus: "candidate",
  },
  {
    originId: "chicago",
    cityCode: "CHI",
    countryCode: "US",
    planningCurrency: "USD",
    seoStatus: "candidate",
  },
  {
    originId: "new-york",
    cityCode: "NYC",
    countryCode: "US",
    planningCurrency: "USD",
    seoStatus: "candidate",
  },
  {
    originId: "basel",
    cityCode: "BSL",
    countryCode: "CH",
    planningCurrency: "CHF",
    seoStatus: "candidate",
  },
  {
    originId: "geneva",
    cityCode: "GVA",
    countryCode: "CH",
    planningCurrency: "CHF",
    seoStatus: "candidate",
  },
  {
    originId: "vienna",
    cityCode: "VIE",
    countryCode: "AT",
    planningCurrency: "EUR",
    seoStatus: "candidate",
  },
  {
    originId: "prishtina",
    cityCode: "PRN",
    countryCode: "XK",
    planningCurrency: "EUR",
    seoStatus: "candidate",
    nearbyAirportGroup: "balkan-eur",
  },
  {
    originId: "skopje",
    cityCode: "SKP",
    countryCode: "MK",
    planningCurrency: "EUR",
    seoStatus: "candidate",
    nearbyAirportGroup: "balkan-eur",
  },
];
const euroCountries = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PT",
  "SK",
  "SI",
  "ES",
  "XK",
  "ME",
  "AL",
  "MK",
]);
export function marketProfile(origin?: TravelLocation) {
  return marketProfiles.find(
    (p) =>
      (p.originId === origin?.id ||
        (!!p.cityCode && p.cityCode === origin?.cityCode)) &&
      p.countryCode === origin?.countryCode,
  );
}
export type CurrencyResolutionResult = {
  currency: CurrencyCode;
  source: "profile" | "country" | "fallback";
};
export function planningCurrency(
  origin?: TravelLocation,
): CurrencyResolutionResult {
  const profile = marketProfile(origin);
  if (profile) return { currency: profile.planningCurrency, source: "profile" };
  const country = origin?.countryCode;
  const currency =
    country === "GB"
      ? "GBP"
      : country === "CH"
        ? "CHF"
        : country === "US"
          ? "USD"
          : country && euroCountries.has(country)
            ? "EUR"
            : undefined;
  return currency
    ? { currency, source: "country" }
    : { currency: "EUR", source: "fallback" };
}
export function publicationCurrency(origin: TravelLocation) {
  return (
    marketProfile(origin)?.seoCurrency ?? planningCurrency(origin).currency
  );
}
