import type {
  FlightDiscoveryFare,
  PriceQuote,
  TripRequest,
  TripPlan,
} from "./types";
import { classifyFareEvidence } from "./fare-evidence";
export type FlightPriceUnavailableReason =
  | "no-matching-fare"
  | "provider-unavailable"
  | "currency-mismatch"
  | "stale-fare"
  | "observation-unconfirmed"
  | "invalid-fare"
  | "unsupported-route";
export type FlightPricingState =
  | { kind: "priced"; quote: PriceQuote; fare: FlightDiscoveryFare }
  | { kind: "reference"; referenceFare: FlightDiscoveryFare }
  | { kind: "unavailable"; reason: FlightPriceUnavailableReason };
/** Provider lookup health is separate. Only usable, scoped evidence can authorize a complete flight price. */
export function resolveFlightPricing(
  fare: FlightDiscoveryFare | undefined,
  request: TripRequest,
): FlightPricingState {
  if (!fare) return { kind: "unavailable", reason: "no-matching-fare" };
  const quality = classifyFareEvidence(fare, request);
  switch (quality) {
    case "exact":
    case "flexible":
      return { kind: "priced", quote: fare.price, fare };
    case "reference":
      return { kind: "reference", referenceFare: fare };
    case "stale":
      return { kind: "unavailable", reason: "stale-fare" };
    case "unconfirmed":
      return { kind: "unavailable", reason: "observation-unconfirmed" };
    case "currency-mismatch":
      return { kind: "unavailable", reason: "currency-mismatch" };
    default:
      return { kind: "unavailable", reason: "invalid-fare" };
  }
}

export function matchingFlight(plan: Pick<TripPlan, "flightPricing">) {
  return plan.flightPricing?.kind === "priced"
    ? plan.flightPricing.fare
    : undefined;
}
export function referenceFlight(plan: Pick<TripPlan, "flightPricing">) {
  return plan.flightPricing?.kind === "reference"
    ? plan.flightPricing.referenceFare
    : undefined;
}
export function completePlan(
  plan: TripPlan,
): plan is Extract<TripPlan, { pricingCompleteness: "complete" }> {
  return plan.pricingCompleteness === "complete";
}
export function pricingReason(
  plan: TripPlan,
):
  | "completeBudgetFit"
  | "completeBudgetOver"
  | "recentFlightFare"
  | "flightPriceNeedsCheck"
  | "referenceFareAvailable" {
  if (!completePlan(plan))
    return plan.flightPricing?.kind === "reference"
      ? "referenceFareAvailable"
      : "flightPriceNeedsCheck";
  return plan.budget.fit === "over"
    ? "completeBudgetOver"
    : matchingFlight(plan)
      ? "recentFlightFare"
      : "completeBudgetFit";
}
