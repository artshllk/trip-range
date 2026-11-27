import { compareFareEvidence, selfAirportFare } from "./fare-evidence";
export { fareDateMatch } from "./fare-evidence";
import type { Destination, FlightDiscoveryFare, TripRequest } from "./types";
export const MAX_FLIGHT_DESTINATIONS = 10;
/** Resolve and deduplicate evidence; only whole-trip ranking may truncate destinations. */
export function shortlistFlights(
  fares: FlightDiscoveryFare[],
  destinations: Destination[],
  request: TripRequest,
) {
  const known = new Map(
    destinations.flatMap((d) =>
      (d.iataCodes ?? []).map((code) => [code, d] as const),
    ),
  );
  const selected = new Map<
    string,
    { destination: Destination; fare: FlightDiscoveryFare }
  >();
  let unknown = 0;
  for (const fare of sortDiscoveryFares(fares, request)) {
    const destination =
      known.get(fare.destinationCode) ??
      known.get(fare.destinationAirport ?? "");
    if (!destination) {
      unknown++;
      continue;
    }
    const key = `${destination.id}:${fare.destinationAirport ?? ""}`;
    if (destination.id === request.originId || selected.has(key)) continue;
    selected.set(key, { destination, fare });
  }
  return { candidates: [...selected.values()], unknown };
}

export function sortDiscoveryFares(
  fares: FlightDiscoveryFare[],
  request: TripRequest,
) {
  return fares
    .filter(
      (fare) =>
        !selfAirportFare(fare) &&
        fare.price.amount.currency === request.budget.currency,
    )
    .sort((a, b) => compareFareEvidence(a, b, request));
}
