import { flightDestinations } from "../../catalogue/flight-destinations";
import type { Destination } from "../types";
import type { DestinationCostId } from "./types";
/** Only normalized city identities or exact curated ID/country pairs; never display names or airport guesses. */
export function destinationCostId(
  destination: Destination,
): DestinationCostId | undefined {
  if (/^place:Q[1-9]\d*$/.test(destination.id))
    return destination.id as DestinationCostId;
  if (/^city:[A-Z]{3}$/.test(destination.id)) {
    const code = destination.id.slice(5);
    return destination.cityCode === code ||
      destination.iataCodes?.includes(code)
      ? (destination.id as DestinationCostId)
      : undefined;
  }
  const curated = flightDestinations.find(
    (d) => d.id === destination.id && d.countryCode === destination.countryCode,
  );
  const code = curated?.iataCodes?.[0];
  return code && /^[A-Z]{3}$/.test(code) ? `city:${code}` : undefined;
}
