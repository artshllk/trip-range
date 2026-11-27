import "server-only";
import { serverEnvironment } from "../providers/server/environment";
import { createFlightHttp } from "../providers/server/flight-http";
import { nearestPlacesUrl } from "../providers/server/travelpayouts";
import { parseNearbyFares, type NearbyFare } from "../domain/nearby-fares";
import type { FlightHandoff } from "../domain/affiliate";

/** No-fare state only: cached fares from nearby airports. Failure is an empty list. */
export async function nearbyFlightFares(
  route: FlightHandoff,
  currency: string,
): Promise<NearbyFare[]> {
  const token = serverEnvironment().travelpayouts.TRAVELPAYOUTS_API_TOKEN;
  if (!token) return [];
  const result = await createFlightHttp(token)(
    nearestPlacesUrl({
      origin: route.originCode,
      destination: route.destinationCode,
      departureDate: route.departureDate,
      returnDate: route.returnDate,
      currency,
    }).toString(),
    3000,
  );
  return result.ok
    ? parseNearbyFares(
        result.body,
        currency,
        route.originCode,
        result.fetchedAt ?? null,
      )
    : [];
}
