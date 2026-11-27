import type { TravelLocation } from "../domain/types";
import type { SeoLandingKey } from "./identity";
/** Architecture examples only. Never imported by routes, sitemap or the publication registry. */
export const worldwideSeoDrafts: readonly {
  key: SeoLandingKey;
  origin: TravelLocation;
  title: string;
  h1: string;
  approved: false;
}[] = [
  {
    key: {
      locale: "en",
      originId: "london",
      intent: "budget",
      budget: { cents: 50000, currency: "GBP" },
    },
    origin: {
      id: "city:LON",
      name: "London",
      type: "city",
      countryCode: "GB",
      countryName: { en: "United Kingdom", sq: "Mbretëria e Bashkuar" },
      cityCode: "LON",
      iataCodes: ["LON"],
    },
    title: "Weekend Trips From London Under £500 | GoEksplo",
    h1: "Weekend trips from London under £500",
    approved: false,
  },
  {
    key: {
      locale: "en",
      originId: "new-york",
      intent: "budget",
      budget: { cents: 70000, currency: "USD" },
    },
    origin: {
      id: "city:NYC",
      name: "New York",
      type: "city",
      countryCode: "US",
      countryName: { en: "United States", sq: "Shtetet e Bashkuara" },
      cityCode: "NYC",
      iataCodes: ["NYC"],
    },
    title: "Weekend Trips From New York Under $700 | GoEksplo",
    h1: "Weekend trips from New York under $700",
    approved: false,
  },
];
