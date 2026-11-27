import { planningCostPolicy } from "../../domain/money/planning-rates";
import { isExcludedTravelDestination } from "../../domain/destination-lifecycle";
import { dynamicDestination } from "../../domain/dynamic-destinations";
import { createDestinationResolver } from "./destination-resolver";
import { curatedNearbyAirports } from "../nearby-airports";
import { matchesDestination } from "../../domain/locations";
import type { TripRequest, Destination } from "../../domain/types";
import "server-only";
import { destinationAccess } from "../../travel/runtime/access";
import { travelpayoutsEnvironment, serverEnvironment } from "./environment";
import { demoProviders } from "../demo";
import {
  flightDestinations,
  existingAirportCodes,
} from "../../catalogue/flight-destinations";
import { createTravelpayoutsDiscovery } from "./travelpayouts";
import { createFlightHttp, type FlightHttpFactory } from "./flight-http";
import { createDestinationImages } from "./images";
import type { TravelProviders } from "../contracts";
import type { ProviderFetch } from "./http";
import { money } from "../../domain/budget";
export type ProviderEnvironment = {
  TRAVELPAYOUTS_API_TOKEN?: string;
  PEXELS_API_KEY?: string;
};
/** The only environment-dependent composition boundary. Nothing in this object crosses to client props. */
export async function createTravelProviders(
  env: ProviderEnvironment = {
    TRAVELPAYOUTS_API_TOKEN: travelpayoutsEnvironment().TRAVELPAYOUTS_API_TOKEN,
    PEXELS_API_KEY: serverEnvironment().pexelsKey,
  },
  fetcher: ProviderFetch = fetch,
  _cacheImages = false,
  request?: TripRequest,
  flightHttp: FlightHttpFactory = createFlightHttp,
): Promise<TravelProviders> {
  // Retain the call signature; approval reads must never reuse the old discovered-image cache.
  void _cacheImages;
  const demo = await demoProviders.destinations.list();
  const token = env.TRAVELPAYOUTS_API_TOKEN?.trim();
  // Trusted destination identity must survive missing credentials/fare evidence.
  const catalogue: Destination[] = [
    // Road-only demo destinations had no price source but the demo road table;
    // with that removed they are not searched. Airport-bearing ones remain flights.
    ...demo
      .filter((d) => existingAirportCodes[d.id])
      .map((d) => ({ ...d, iataCodes: existingAirportCodes[d.id] })),
    ...flightDestinations,
  ]
    .filter((d) => !isExcludedTravelDestination(d))
    .map((d) => ({
      ...d,
      iataCodes: d.iataCodes ? [...d.iataCodes] : undefined,
    }));
  const selected = request?.destination;
  if (
    selected &&
    selected.type !== "country" &&
    !isExcludedTravelDestination(selected) &&
    !catalogue.some((d) => matchesDestination(d, selected))
  ) {
    if (/^place:Q[1-9]\d{0,11}$/.test(selected.id)) {
      // Canonical place snapshots cannot invent a provider city or an airport.
      // Unknown, expired or unreviewed access remains unavailable.
      const access = destinationAccess.get(selected.id);
      if (access) catalogue.push(access.destination);
    } else {
      const destination = dynamicDestination(selected);
      catalogue.push(destination);
    }
  }
  const images = createDestinationImages(
    catalogue,
    undefined,
    destinationAccess,
  );
  return {
    ...demoProviders,
    destinationAccess,
    nearbyAirports: curatedNearbyAirports,
    destinationResolver: createDestinationResolver(catalogue, fetcher),
    places: {
      async itinerary(d, nights) {
        if (!d.metadataSource) return demoProviders.places.itinerary(d, nights);
        return Array.from({ length: nights + 1 }, (_, i) => ({
          en:
            i === 0
              ? "Arrival and free time."
              : i === nights
                ? "Free time and the journey home."
                : "Explore the city and try local food. Generic planning suggestion.",
          sq:
            i === 0
              ? "Mbërritja dhe kohë e lirë."
              : i === nights
                ? "Kohë e lirë dhe kthimi në shtëpi."
                : "Eksploro qytetin dhe ushqimin lokal. Sugjerim i përgjithshëm planifikimi.",
        }));
      },
    },
    locations: {
      async get(id) {
        return request?.origin?.id === id
          ? request.origin
          : demoProviders.locations.get(id);
      },
    },
    transport: {
      // No demo road prices in production. Every catalogue destination is priced
      // from real flight fares; none means "no matching fare", never a fixture.
      async quote() {
        return {
          status: "available",
          value: {
            mode: "flight",
            flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
          },
        };
      },
    },
    discovery: token
      ? createTravelpayoutsDiscovery(
          token,
          fetcher,
          undefined,
          undefined,
          undefined,
          flightHttp(token, fetcher),
        )
      : undefined,
    destinations: {
      async list() {
        return catalogue;
      },
    },
    images,
    stays: {
      async quote(r, d) {
        // Baseline room estimate; explicitly not a hotel-provider quote. Demo stay
        // amounts are never used in production.
        const amount =
          r.budget.currency !== "EUR"
            ? money(
                planningCostPolicy[r.budget.currency].stayTwoNights,
                r.budget.currency,
              )
            : d.estimatedStay
              ? d.estimatedStay.currency === r.budget.currency
                ? d.estimatedStay
                : money(
                    planningCostPolicy[r.budget.currency].stayTwoNights,
                    r.budget.currency,
                  )
              : money(planningCostPolicy.EUR.stayTwoNights, "EUR");
        return {
          status: "available",
          value: {
            amount,
            confidence: "estimate",
            planning: [
              {
                component: "stay",
                basis:
                  r.budget.currency === "EUR" &&
                  !d.metadataSource &&
                  d.estimatedStay
                    ? "curated-legacy"
                    : "generic-currency",
                sourceIds: [],
              },
            ],
            providerId: "goeksplo-stay-estimate",
            observedAt: null,
            demo: false,
            source: { status: "available" },
          },
        };
      },
    },
  };
}
