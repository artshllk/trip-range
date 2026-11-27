import { comparePlans } from "../domain/airport-comparison";
import {
  arrivalAccess,
  directArrival,
  directBindings,
  directEntryForCode,
  gatewayForCode,
} from "../domain/destination-access/arrival";
import type {
  AccessibleDestination,
  ArrivalAccess,
  DirectArrival,
} from "../domain/destination-access/types";
import { pricePlan } from "../domain/pricing";
import { matchingFlight, referenceFlight } from "../domain/flight-pricing";
import type {
  FlightDiscoveryFare,
  TripRequest,
  TripTemplate,
} from "../domain/types";

type ReviewedDetailArrival = {
  airportCode: string;
  arrival?: ArrivalAccess;
  directArrival?: DirectArrival;
};

/** Access must come from the current reviewed store. A URL/group alone cannot pin an airport. */
export function reviewedDetailArrival(
  id: string | undefined,
  request: TripRequest,
  access?: AccessibleDestination,
): ReviewedDetailArrival | undefined {
  const hint = request.arrivalEntry;
  if (
    !id ||
    !access ||
    id !== access.destination.id ||
    hint?.destinationId !== id ||
    (request.destination?.airportIata &&
      request.destination.airportIata !== hint.code)
  )
    return;
  const code = hint.code;
  if (gatewayForCode(access, code)) {
    const arrival = arrivalAccess(
      access,
      undefined,
      request.budget.currency,
      code,
    );
    if (arrival?.airportCode)
      return { airportCode: arrival.airportCode, arrival };
  }
  if (directEntryForCode(access, code)) {
    const direct = directArrival(access, undefined, code);
    if (direct?.airportCode)
      return { airportCode: direct.airportCode, directArrival: direct };
  }
  if (access.directCity?.airportCodes.includes(code))
    return {
      airportCode: code,
      arrival: arrivalAccess(access, undefined, request.budget.currency, code),
      directArrival: {
        airportCode: code,
        flightDestinationCode: code,
        label: { en: code, sq: code },
      },
    };
}

/** Additional detail-only constraint; normal fare identity/date checks still apply. */
export function fareMatchesDetailArrival(
  fare: FlightDiscoveryFare,
  airportCode: string,
  access: AccessibleDestination,
) {
  if (fare.destinationAirport) return fare.destinationAirport === airportCode;
  if (fare.destinationCode !== airportCode) return false;
  // A group may share an airport's code (DXB) without proving that airport.
  const groupAirports = [
    ...directBindings(access)
      .filter((binding) => binding.providerCityCode === fare.destinationCode)
      .flatMap((binding) => binding.airportCodes),
    ...access.gateways
      .filter((gateway) => gateway.providerCityCode === fare.destinationCode)
      .map((gateway) => gateway.airportCode),
  ];
  return groupAirports.every((airport) => airport === airportCode);
}

/** Detail continuity is a filter before ranking, never a change to discovery ranking. */
export function selectTripDetailTemplate(
  templates: TripTemplate[],
  request: TripRequest,
  id: string,
  access?: AccessibleDestination,
) {
  const selected = reviewedDetailArrival(id, request, access);
  const candidates = templates.filter(
    (template) =>
      template.id === id &&
      (!request.departureAirport ||
        template.transport.departure?.code === request.departureAirport) &&
      (!selected ||
        (template.transport.mode === "flight" &&
          (template.transport.arrival?.airportCode ??
            template.transport.directArrival?.airportCode) ===
            selected.airportCode)),
  );
  return candidates.some((t) => t.transport.arrival)
    ? candidates
        .map((base) => ({ base, plan: pricePlan(base, request) }))
        .sort((a, b) => comparePlans(a.plan, b.plan))[0]?.base
    : candidates[0];
}

/** The results search's own template for this trip, when it carries a fare. The same
 * request makes the same provider calls (served from the flight cache) and the same
 * selection, so the fare a card showed is the fare its page shows. A targeted search
 * sees different rows and can pick a different fare; it is only the fallback. */
export function sharedResultTemplate(
  templates: TripTemplate[],
  request: TripRequest,
  id: string,
  access?: AccessibleDestination,
) {
  const base = selectTripDetailTemplate(templates, request, id, access);
  if (!base) return;
  const plan = pricePlan(base, request);
  return matchingFlight(plan) || referenceFlight(plan) ? base : undefined;
}
