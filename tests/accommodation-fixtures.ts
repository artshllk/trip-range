/** Synthetic arithmetic/availability only; never import into production composition. */
import type { AccommodationQuote } from "../src/domain/accommodation-evidence";
import type { TripTemplate, TripRequest } from "../src/domain/types";
export const stayNow = Date.parse("2026-10-13T18:00:00Z");
export function stayQuote(
  base: TripTemplate,
  request: TripRequest,
): AccommodationQuote {
  const currency = request.budget.currency;
  return {
    provider: "synthetic-stay",
    propertyId: "synthetic-property",
    productId: "synthetic-product",
    location: {
      destinationId: base.destination.id,
      countryCode: base.destination.countryCode,
      providerLocationId: "synthetic-location",
      binding: "exact",
    },
    checkin: request.dates.startDate,
    checkout: request.dates.endDate,
    adults: request.party.adults,
    children: 0,
    childrenPolicy: "adult-only",
    allocation: { adults: request.party.adults, rooms: 1, basis: "provider" },
    booker: { country: "CH", platform: "desktop", source: "explicit" },
    level: request.preferences.stayLevel,
    propertyType: "hotel",
    privateRoom: true,
    stars: request.preferences.stayLevel === "comfort" ? 4 : 3,
    reviewScore: 8.5,
    reviewCount: 50,
    publicRate: true,
    cancellation: "non-refundable",
    meals: "breakfast",
    charges: {
      base: { cents: 16000, currency },
      includedMandatory: { cents: 2000, currency },
      excludedMandatory: { cents: 1500, currency },
      total: { cents: 19500, currency },
      unknownMandatory: false,
      conditional: false,
    },
    observedAt: "2026-10-13T17:59:00Z",
    retrievedAt: "2026-10-13T18:00:00Z",
  };
}
