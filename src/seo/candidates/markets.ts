import type { MoneyAmount, TravelLocation } from "../../domain/types";
export type CandidateOrigin = "london" | "manchester" | "dublin" | "chicago";
export type CandidateMarket = {
  slug: CandidateOrigin;
  origin: TravelLocation;
  budget: MoneyAmount;
};
// Reviewed product identities, deliberately separate from URL slugs and publication authority.
export const candidateMarkets: readonly CandidateMarket[] = [
  {
    slug: "london",
    origin: {
      id: "city:LON",
      type: "city",
      name: "London",
      cityCode: "LON",
      iataCodes: ["LON"],
      countryCode: "GB",
      countryName: { en: "United Kingdom", sq: "Mbretëria e Bashkuar" },
    },
    budget: { cents: 50000, currency: "GBP" },
  },
  {
    slug: "manchester",
    origin: {
      id: "city:MAN",
      type: "city",
      name: "Manchester",
      cityCode: "MAN",
      iataCodes: ["MAN"],
      countryCode: "GB",
      countryName: { en: "United Kingdom", sq: "Mbretëria e Bashkuar" },
    },
    budget: { cents: 50000, currency: "GBP" },
  },
  {
    slug: "dublin",
    origin: {
      id: "city:DUB",
      type: "city",
      name: "Dublin",
      cityCode: "DUB",
      iataCodes: ["DUB"],
      countryCode: "IE",
      countryName: { en: "Ireland", sq: "Irlandë" },
    },
    budget: { cents: 50000, currency: "EUR" },
  },
  {
    slug: "chicago",
    origin: {
      id: "city:CHI",
      type: "city",
      name: "Chicago",
      cityCode: "CHI",
      iataCodes: ["CHI"],
      countryCode: "US",
      countryName: { en: "United States", sq: "Shtetet e Bashkuara" },
    },
    budget: { cents: 120000, currency: "USD" },
  },
];
