import { matchingFlight, referenceFlight } from "./flight-pricing";
import { quoteMoney, fareMoney } from "./money/provenance";
import { fareFreshness } from "./money/freshness";
import type { TripPlan, TravelerParty } from "./types";
import { isCalendarDate, nightsBetween } from "./dates";
import { existingAirportCodes } from "../catalogue/flight-destinations";

export type AffiliatePlacement = "results" | "trip";
export type FlightHandoff = {
  originCode: string;
  destinationCode: string;
  departureDate: string;
  returnDate: string;
  party: TravelerParty;
};
export type AffiliateLink = { provider: string; url: string };
export type AffiliateResult =
  | { status: "available"; link: AffiliateLink }
  | {
      status: "unavailable";
      reason:
        | "configuration"
        | "unsupported"
        | "timeout"
        | "authentication"
        | "rate-limit"
        | "provider"
        | "malformed";
    };
const iata = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);
export function readFlightHandoff(value: unknown): FlightHandoff | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as FlightHandoff;
  if (
    !iata(v.originCode) ||
    !iata(v.destinationCode) ||
    v.originCode === v.destinationCode ||
    !isCalendarDate(v.departureDate) ||
    !isCalendarDate(v.returnDate) ||
    nightsBetween(v.departureDate, v.returnDate) < 1 ||
    nightsBetween(v.departureDate, v.returnDate) > 14 ||
    !v.party ||
    !Number.isInteger(v.party.adults) ||
    v.party.adults < 1 ||
    v.party.adults > 9 ||
    !Number.isInteger(v.party.children) ||
    v.party.children < 0 ||
    v.party.children > 9 ||
    v.party.adults + v.party.children > 9
  )
    return;
  return {
    originCode: v.originCode,
    destinationCode: v.destinationCode,
    departureDate: v.departureDate,
    returnDate: v.returnDate,
    party: { adults: v.party.adults, children: v.party.children },
  };
}
/** Actual plan/request dates only. Reference fare dates and provider deep links are never used. */
export function flightHandoff(plan: TripPlan): FlightHandoff | undefined {
  if (plan.transportMode !== "flight" || plan.origin.type === "country") return;
  const selected = plan.request.destination;
  return readFlightHandoff({
    originCode:
      matchingFlight(plan)?.originAirport ??
      plan.departure?.code ??
      matchingFlight(plan)?.originCode ??
      plan.origin.airportIata ??
      plan.origin.cityCode ??
      plan.origin.iataCodes?.[0],
    destinationCode:
      plan.arrival?.flightDestinationCode ??
      selected?.airportIata ??
      matchingFlight(plan)?.destinationAirport ??
      matchingFlight(plan)?.destinationCode ??
      plan.directArrival?.flightDestinationCode ??
      selected?.cityCode ??
      plan.destination.iataCodes?.[0] ??
      existingAirportCodes[plan.destination.id]?.[0],
    departureDate: plan.request.dates.startDate,
    returnDate: plan.request.dates.endDate,
    party: plan.request.party,
  });
}
export function flightConfidence(plan: TripPlan): "recent" | "unavailable" {
  return matchingFlight(plan) ? "recent" : "unavailable";
}
/** Which pricing state the traveller saw when they clicked. */
export type HandoffState = "priced" | "partial" | "no_fare";
export type FareAgeBucket = "fresh" | "aging" | "old" | "unknown";
export function isFareAge(value: unknown): value is FareAgeBucket {
  return (
    value === "fresh" ||
    value === "aging" ||
    value === "old" ||
    value === "unknown"
  );
}
export type HandoffContext = { state: HandoffState; fareAge: FareAgeBucket };

/** Result cards omit reference fares. Use the age band for the button’s own surface. */
export function handoffFareAge(
  plan: TripPlan,
  now: number,
  placement: AffiliatePlacement = "trip",
): FareAgeBucket {
  const transport = plan.costs.find((c) => c.category === "transport");
  const reference = placement === "trip" ? referenceFlight(plan) : undefined;
  const fare = transport
    ? quoteMoney(transport)
    : reference
      ? fareMoney(reference)
      : undefined;
  return (fare && fareFreshness(fare, now)?.tier) ?? "unknown";
}
export function readHandoffContext(value: unknown): HandoffContext | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as HandoffContext;
  if (Object.keys(v).some((k) => !["state", "fareAge"].includes(k))) return;
  if (!["priced", "partial", "no_fare"].includes(v.state)) return;
  if (!isFareAge(v.fareAge)) return;
  return { state: v.state, fareAge: v.fareAge };
}

export type AffiliateCount = {
  originCode: string;
  destinationCode: string;
  fareAge: FareAgeBucket;
  outcome: "view" | "click_available" | "click_unavailable";
};

/** Accept old tabs' view shape, but pass only the counter dimensions to storage. */
export function readAffiliateEvent(value: unknown): AffiliateCount | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  const allowed = [
    "event",
    "originCode",
    "destinationCode",
    "fareAge",
    "placement",
    "state",
  ];
  if (
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    v.event !== "cta_view" ||
    !iata(v.originCode) ||
    !iata(v.destinationCode) ||
    (v.placement !== undefined &&
      v.placement !== "results" &&
      v.placement !== "trip") ||
    (v.state !== undefined &&
      !["priced", "partial", "no_fare"].includes(String(v.state))) ||
    !isFareAge(v.fareAge)
  )
    return;
  return {
    outcome: "view",
    originCode: v.originCode,
    destinationCode: v.destinationCode,
    fareAge: v.fareAge,
  };
}
