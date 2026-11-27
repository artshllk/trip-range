import {
  completePlan,
  matchingFlight,
  referenceFlight,
} from "../domain/flight-pricing";
import { chooseDeparturePlans } from "../domain/airport-comparison";
import { matchingPlans, curate } from "../domain/ranking";
import { pricePlan } from "../domain/pricing";
import { referenceCalendarDate } from "../domain/dates";
import { defaultRequestFor, requestQuery } from "../domain/request";
import type { MoneyAmount, TripPlan, TripRequest } from "../domain/types";
import type { TripSearch } from "../services/travel";
import type { SeoEditorialDefinition } from "./definition";
import { resolveSeoDates } from "./date-contract";
export type SeoSummary = {
  destinationsChecked: number;
  fitsCount: number;
  completeCalculationCount: number;
  cheapestEstimatedSpend: MoneyAmount | null;
  cheapestBudgetNeeded: MoneyAmount | null;
  lowestCostDestination: string | null;
  recentFareCount: number;
  unpricedFlightCount: number;
  providerSupportedFitsCount: number;
  referenceFareCount: number;
  providerSupportedCount: number;
  observationRange: { first: string; last: string } | null;
};
export function seoRequest(
  page: SeoEditorialDefinition,
  today: string,
): TripRequest {
  const base = defaultRequestFor(today);
  return {
    ...base,
    dates: resolveSeoDates(page.dateContract, today),
    when: page.dateContract.kind === "month-weekends" ? "custom" : base.when,
    originId: page.origin.id,
    origin: page.origin,
    budget: page.budget ?? page.exampleBudget,
    party: { adults: 2, children: 0 },
    preferences: { ...base.preferences, nearbyAirports: false, luggage: false },
  };
}
export function seoSearchHref(request: TripRequest) {
  return `/plan/results?${requestQuery(request)}`;
}
function complete(p: TripPlan) {
  const categories = ["transport", "stay", "food", "local", "activities"];
  return (
    completePlan(p) &&
    categories.every((c) => p.costs.some((item) => item.category === c)) &&
    p.costs.every(
      (c) =>
        c.amount.currency === p.request.budget.currency &&
        Number.isSafeInteger(c.amount.cents) &&
        c.amount.cents >= 0,
    ) &&
    p.budget.estimatedSpend.cents > 0 &&
    p.costs.reduce((n, c) => n + c.amount.cents, 0) ===
      p.budget.estimatedSpend.cents &&
    p.budget.budgetNeeded.cents ===
      p.budget.estimatedSpend.cents + p.safetyBuffer.cents
  );
}
export function summarizePlans(
  input: TripPlan[],
  request: TripRequest,
  now: string,
): SeoSummary {
  const plans = chooseDeparturePlans(matchingPlans(input, request));
  const completePlans = plans.filter(completePlan).filter(complete);
  const cheapest = [...completePlans].sort(
    (a, b) =>
      a.budget.budgetNeeded.cents - b.budget.budgetNeeded.cents ||
      a.id.localeCompare(b.id),
  )[0];
  const supported = completePlans.filter((p) => !!matchingFlight(p));
  const recent = supported;
  const observations = plans
    .flatMap((p) =>
      [matchingFlight(p), referenceFlight(p)].flatMap((f) =>
        f?.price.observedAt &&
        !f.price.demo &&
        Number.isFinite(Date.parse(f.price.observedAt)) &&
        Date.parse(f.price.observedAt) <= Date.parse(now)
          ? [f.price.observedAt]
          : [],
      ),
    )
    .sort();
  return {
    destinationsChecked: plans.length,
    fitsCount: completePlans.filter((p) => p.budget.fit !== "over").length,
    providerSupportedFitsCount: supported.filter((p) => p.budget.fit !== "over")
      .length,
    completeCalculationCount: plans.filter(complete).length,
    cheapestEstimatedSpend: cheapest?.budget.estimatedSpend ?? null,
    cheapestBudgetNeeded: cheapest?.budget.budgetNeeded ?? null,
    lowestCostDestination: cheapest?.destination.name.en ?? null,
    recentFareCount: recent.length,
    unpricedFlightCount: plans.filter((p) => !completePlan(p)).length,
    referenceFareCount: plans.filter((p) => !!referenceFlight(p)).length,
    providerSupportedCount: supported.length,
    observationRange: observations.length
      ? {
          first: observations[0].slice(0, 10),
          last: observations[observations.length - 1].slice(0, 10),
        }
      : null,
  };
}
/** Calls the existing pricing/ranking engine. No SEO-specific price arithmetic or invented candidates. */
export function evaluateSeoTrips(
  search: TripSearch,
  request: TripRequest,
  now: string,
) {
  const plans = search.templates.map((t) =>
    pricePlan(t, request, "none", undefined, {
      today: referenceCalendarDate(new Date(now)),
    }),
  );
  const ranked = curate(plans, request);
  return {
    summary: summarizePlans(plans, request, now),
    cards: ranked.cards.length
      ? ranked.cards
      : chooseDeparturePlans(plans).filter(completePlan).slice(0, 3),
    cheapest: ranked.cheapest,
  };
}
