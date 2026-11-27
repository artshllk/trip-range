import type { TravelLocation, TripRequest } from "../../domain/types";

/** Keep saved detail context separate from the original (possibly broad) search
 * filter. This never validates an airport: detail restoration still checks the
 * current reviewed access record before consuming any retained hint. */
export function searchArrivalEntry(
  initial: TripRequest,
  destination: TravelLocation | undefined,
  destinationEdited: boolean,
): TripRequest["arrivalEntry"] {
  const arrival = initial.arrivalEntry;
  if (!arrival) return;
  // Independent edits retain the original selection, including a saved trip
  // discovered through Anywhere or a country filter. Explicit Anywhere clears it.
  if (!destinationEdited && destination === initial.destination) return arrival;
  // A reselected country, city group or gateway is not proof of canonical place
  // identity. Names and overlapping transport codes cannot restore the old pin.
  if (
    destination?.id === arrival.destinationId &&
    destination.type !== "country" &&
    (!destination.airportIata || destination.airportIata === arrival.code)
  )
    return arrival;
}
