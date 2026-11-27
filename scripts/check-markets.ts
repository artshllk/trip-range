import {
  marketProfiles,
  planningCurrency,
  publicationCurrency,
} from "../src/domain/market/policy";
import { supportedCurrencies } from "../src/domain/money/currency";
import { travelpayoutsMarket } from "../src/providers/server/travelpayouts-policy";
import { seoLandingRegistry } from "../src/seo/registry";
import { worldwideSeoDrafts } from "../src/seo/drafts";
import type { TravelLocation } from "../src/domain/types";
console.log("Offline market policy diagnostic; no provider or AI calls.");
console.log(
  JSON.stringify({
    supportedCurrencies,
    providerMarket: travelpayoutsMarket,
    nonEurFaresRequireCurrencyEvidence: true,
    chfProviderCoverage: "unconfirmed",
  }),
);
for (const profile of marketProfiles) {
  const origin: TravelLocation = {
    id: profile.originId,
    name: profile.originId,
    type: "city",
    countryCode: profile.countryCode,
    countryName: { en: profile.countryCode, sq: profile.countryCode },
  };
  console.log(
    JSON.stringify({
      origin: profile.originId,
      planning: planningCurrency(origin),
      publicationCurrency: publicationCurrency(origin),
      seo: profile.seoStatus,
      approvedDefinitions: seoLandingRegistry.filter(
        (p) => p.origin.id === origin.id && p.approved,
      ).length,
      nearbyAirports: profile.nearbyAirportGroup ?? "none",
    }),
  );
}
console.log(
  JSON.stringify({
    drafts: worldwideSeoDrafts.map((d) => ({
      origin: d.key.originId,
      approved: d.approved,
    })),
    unknownCountryFallback: planningCurrency(),
    fallbackIsConversion: false,
  }),
);
