import { isCalendarDate, nightsBetween, weekendsInMonth } from "./dates";
import type { FlightDiscoveryFare, TripRequest } from "./types";
/** Recheck this at pricing time; reference dates must never enter an actual quote. */
export function fareDateMatch(
  fare: FlightDiscoveryFare,
  request: TripRequest,
): "exact" | "flexible" | "reference" {
  if (fare.scope.journey !== "return") return "reference";
  const dates = fare.scope.dates;
  if (request.dates.mode === "weekends")
    return weekendsInMonth(request.dates.month!, request.dates.startDate).some(
      (d) => d.startDate === dates.startDate && d.endDate === dates.endDate,
    )
      ? "flexible"
      : "reference";
  const start = Math.abs(
    nightsBetween(request.dates.startDate, dates.startDate),
  );
  const end = Math.abs(nightsBetween(request.dates.endDate, dates.endDate));
  const nights = nightsBetween(dates.startDate, dates.endDate);
  if (nights < 1 || nights > 14) return "reference";
  if (start === 0 && end === 0) return "exact";
  return request.dates.flexibleDays === 3 && start <= 3 && end <= 3
    ? "flexible"
    : "reference";
}
export function fareDateDistance(
  fare: FlightDiscoveryFare,
  request: TripRequest,
) {
  return (
    Math.abs(
      nightsBetween(request.dates.startDate, fare.scope.dates.startDate),
    ) + Math.abs(nightsBetween(request.dates.endDate, fare.scope.dates.endDate))
  );
}

/** The provider retains cached fares 2–7 days; beyond that a found_at is too old to price. */
export const MAX_FARE_AGE_MS = 7 * 24 * 3600_000;
/** Compare operational airports when supplied; a city group must not override them. */
export function selfAirportFare(fare: FlightDiscoveryFare) {
  return (
    (fare.originAirport ?? fare.originCode) ===
    (fare.destinationAirport ?? fare.destinationCode)
  );
}
/** Strict provider observation syntax, not Date.parse's permissive date coercion. */
export function observationTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !isCalendarDate(value.slice(0, 10))
  )
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
/**
 * Provider found_at. The v3 endpoints send an offset ("…Z"); v2/prices/latest sends none.
 * The same fare read from both (2026-10-27) carried identical digits, so an offsetless
 * value is UTC, as documented. Any explicit offset is honoured.
 */
export function providerFoundAt(value: unknown): string | null {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
  )
    return observationTimestamp(`${value}Z`);
  return observationTimestamp(value);
}
/**
 * "unobserved": no found_at joined; still priceable, labelled "last checked".
 * "not-actual": the provider marked the offer not actual; never priced.
 *
 * NOT YET A WORKING CONFIRMATION SIGNAL: `actual` was true on every row observed so far
 * (all live probes on 2026-10-27). We read and honour it, but until a false value is
 * observed there is no evidence it ever excludes anything. Check the store
 * (fare_observations.actual = false) before relying on it.
 */
export function observationQuality(
  value: unknown,
  now: number,
  actual?: boolean,
): "fresh" | "stale" | "unconfirmed" | "unobserved" | "not-actual" {
  if (actual === false) return "not-actual";
  if (value === null || value === undefined) return "unobserved";
  const observation = observationTimestamp(value);
  if (!observation || Date.parse(observation) > now + 5 * 60_000)
    return "unconfirmed";
  return now - Date.parse(observation) > MAX_FARE_AGE_MS ? "stale" : "fresh";
}
export type FareEvidenceQuality =
  | "exact"
  | "flexible"
  | "reference"
  | "stale"
  | "unconfirmed"
  | "currency-mismatch"
  | "invalid";
/** Adapter checks age on every cache read; shared domain classification consumes that evidence.
 * No ambient clock here: rendering the same normalized evidence is deterministic. */
export function classifyFareEvidence(
  fare: FlightDiscoveryFare,
  request: TripRequest,
): FareEvidenceQuality {
  const quote = fare.price;
  if (quote.amount.currency !== request.budget.currency)
    return "currency-mismatch";
  if (
    selfAirportFare(fare) ||
    !isCalendarDate(fare.scope.dates.startDate) ||
    !isCalendarDate(fare.scope.dates.endDate) ||
    nightsBetween(fare.scope.dates.startDate, fare.scope.dates.endDate) < 1 ||
    nightsBetween(fare.scope.dates.startDate, fare.scope.dates.endDate) > 14 ||
    !/^[A-Z]{3}$/.test(fare.originCode) ||
    !/^[A-Z]{3}$/.test(fare.destinationCode) ||
    (fare.originAirport !== undefined &&
      !/^[A-Z]{3}$/.test(fare.originAirport)) ||
    (fare.destinationAirport !== undefined &&
      !/^[A-Z]{3}$/.test(fare.destinationAirport)) ||
    quote.demo ||
    !quote.providerId ||
    quote.providerId.startsWith("goeksplo-") ||
    !Number.isSafeInteger(quote.amount.cents) ||
    quote.amount.cents <= 0 ||
    quote.amount.cents > 100_000_000 ||
    fare.scope.journey !== "return" ||
    (fare.scope.unit === "party" &&
      (fare.scope.party?.adults !== request.party.adults ||
        fare.scope.party?.children !== request.party.children))
  )
    return "invalid";
  if (quote.source.status === "stale") return "stale";
  // A missing observation time does not block pricing; it changes the label.
  if (quote.source.status !== "available") return "unconfirmed";
  if (quote.confidence !== "recent") return "invalid";
  return fareDateMatch(fare, request);
}
const qualityOrder: Record<FareEvidenceQuality, number> = {
  exact: 0,
  flexible: 1,
  reference: 2,
  stale: 3,
  unconfirmed: 4,
  "currency-mismatch": 5,
  invalid: 6,
};
/** Compare evidence quality first, date relevance second, price third. Never response order. */
export function compareFareEvidence(
  a: FlightDiscoveryFare,
  b: FlightDiscoveryFare,
  request: TripRequest,
) {
  const key = (f: FlightDiscoveryFare) =>
    [
      f.destinationCode,
      f.destinationAirport ?? "",
      f.originCode,
      f.originAirport ?? "",
      f.scope.dates.startDate,
      f.scope.dates.endDate,
      f.airline ?? "",
      f.transfers ?? "",
      f.price.observedAt ?? "",
    ].join(":");
  return (
    qualityOrder[classifyFareEvidence(a, request)] -
      qualityOrder[classifyFareEvidence(b, request)] ||
    fareDateDistance(a, request) - fareDateDistance(b, request) ||
    a.price.amount.cents - b.price.amount.cents ||
    key(a).localeCompare(key(b))
  );
}
