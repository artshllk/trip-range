import type {
  DestinationCostId,
  DestinationCostProfile,
} from "../src/domain/costs/types";
import type { CurrencyCode } from "../src/domain/money/currency";
import type {
  Destination,
  TripRequest,
  TripTemplate,
} from "../src/domain/types";
import { defaultRequestFor } from "../src/domain/request";
import { planningCostPolicy } from "../src/domain/money/planning-rates";
// Synthetic arithmetic fixtures only. These amounts are NOT researched cost evidence.
export function costProfile(
  destinationId: DestinationCostId = "city:VIE",
  currency: CurrencyCode = "GBP",
  countryCode = "AT",
): DestinationCostProfile {
  const sourceIds = ["synthetic-test-source"];
  const basket = {
    en: "Synthetic test assumption; never production evidence.",
    sq: "Supozim sintetik për test; jo provë për prodhim.",
  };
  return {
    id: `fixture-${destinationId.slice(5).toLowerCase()}-${currency.toLowerCase()}`,
    destinationId,
    countryCode,
    currency,
    revision: "2026-10-01",
    reviewedAt: "2026-10-01",
    reviewAfter: "2026-12-01",
    reviewStatus: "reviewed",
    maxNights: 7,
    costs: {
      stay: {
        amount: { cents: 7000, currency },
        unit: "room-night",
        sourceIds,
        basket,
      },
      food: {
        amount: { cents: 2000, currency },
        unit: "person-day",
        sourceIds,
        basket,
      },
      localTransport: {
        amount: { cents: 1500, currency },
        unit: "person-trip",
        sourceIds,
        basket,
      },
      arrivalTransport: {
        amount: { cents: 3500, currency },
        unit: "party-trip",
        sourceIds,
        basket,
      },
      activities: {
        amount: { cents: 600, currency },
        unit: "person-night",
        sourceIds,
        basket,
      },
    },
    sourceReferences: [
      {
        id: sourceIds[0],
        url: "https://example.com/synthetic-cost-test",
        checkedAt: "2026-10-01",
        type: "consumer-study",
      },
    ],
  };
}
export const candidateCostFixtures = [
  costProfile(),
  costProfile("city:ROM", "GBP", "IT"),
  costProfile("city:BER", "GBP", "DE"),
  costProfile("city:BUD", "GBP", "HU"),
];
export function costTrip(
  currency: CurrencyCode = "GBP",
  code = "VIE",
  countryCode = "AT",
) {
  const request: TripRequest = {
    ...defaultRequestFor("2026-10-08"),
    budget: { cents: 100000, currency },
    dates: { startDate: "2026-11-07", endDate: "2026-11-09", flexibleDays: 0 },
    nights: 2,
    when: "custom",
    party: { adults: 2, children: 0 },
  };
  const destination = {
    id: `city:${code}`,
    cityCode: code,
    countryCode,
    iataCodes: [code],
    name: { en: code, sq: code },
    country: { en: countryCode, sq: countryCode },
    styles: [],
  } as unknown as Destination;
  const quote = {
    amount: { cents: 2000, currency },
    confidence: "recent" as const,
    demo: false,
    observedAt: "2026-10-08T12:00:00.000Z",
    providerId: "travelpayouts-aviasales-data",
    source: { status: "available" as const },
  };
  const fare = {
    price: quote,
    originCode: "PRN",
    destinationCode: code,
    retrievedAt: quote.observedAt,
    scope: {
      unit: "per-traveller" as const,
      journey: "return" as const,
      dates: request.dates,
      fees: "provider-unspecified" as const,
    },
  };
  const base: TripTemplate = {
    id: destination.id,
    destination,
    origin: {
      id: request.originId,
      name: "Prishtina",
      countryCode: "XK",
    } as TripTemplate["origin"],
    transport: {
      mode: "flight",
      flightPricing: { kind: "priced", quote, fare },
    },
    stay: {
      ...quote,
      amount: { cents: planningCostPolicy[currency].stayTwoNights, currency },
      confidence: "estimate",
      observedAt: null,
      providerId: "goeksplo-stay-estimate",
      planning: [
        { component: "stay", basis: "generic-currency", sourceIds: [] },
      ],
    },
    itinerary: [],
  };
  return { request, base };
}
