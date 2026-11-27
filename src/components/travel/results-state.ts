import type { curate } from "../../domain/ranking";
import type { TripPlan, TripRequest } from "../../domain/types";
import { locations } from "../../catalogue/locations";
import { boundedDepartures } from "../../domain/airports";
import { curatedNearbyAirports } from "../../providers/nearby-airports";
import type { SearchIssue } from "../../services/travel";

export function flightDiscoveryUnavailable(issues: SearchIssue[]) {
  return issues.some(
    (issue) =>
      issue.destinationId === "flight-discovery" &&
      issue.source.status === "unavailable",
  );
}

/** Presentation only: keep the engine's shortlist, amounts and 15% ceiling intact. */
export function resultsState(result: ReturnType<typeof curate>) {
  return result.completeCount === 0 && result.cards.length === 0
    ? "empty"
    : result.pricingState;
}

export function incompleteCostsExceedBudget(plan: TripPlan) {
  if (plan.pricingCompleteness === "complete") return false;
  const known =
    plan.pricingCompleteness === "flight-unpriced"
      ? plan.knownNonFlightCosts
      : plan.knownCosts;
  return (
    known.currency === plan.request.budget.currency &&
    known.cents > plan.request.budget.cents
  );
}

export function nearbyRecoveryAvailable(request: TripRequest) {
  if (
    request.preferences.nearbyAirports ||
    request.noFlight ||
    request.scope === "domestic"
  )
    return false;
  const origin =
    request.origin ?? locations.find((l) => l.id === request.originId);
  if (!origin) return false;
  const expanded = {
    ...request,
    preferences: { ...request.preferences, nearbyAirports: true },
  };
  return (
    boundedDepartures(
      origin,
      curatedNearbyAirports.candidates(expanded, origin),
      request.budget.currency,
    ).length > 1
  );
}

export function missingPriceKinds(plans: TripPlan[]) {
  return {
    flight: plans.some(
      (p) => p.transportMode === "flight" && p.flightPricing?.kind !== "priced",
    ),
    transfer: plans.some(
      (p) => p.arrival?.onwardTransfer.status === "unpriced",
    ),
    stay: plans.some((p) => p.accommodation?.kind === "unavailable"),
  };
}
