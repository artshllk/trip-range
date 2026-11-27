/** Synthetic arithmetic/identity fixtures only; never imported by application code. */
import { costTrip, costProfile } from "../cost-profile-fixtures";
import { pricePlan } from "../../src/domain/pricing";
import type { CurrencyCode } from "../../src/domain/money/currency";
import type { TravelerParty } from "../../src/domain/types";

export const budgetStates = [
  "affordable",
  "exact",
  "close",
  "reserve-over",
  "slightly-over",
  "unaffordable",
  "reference",
  "unpriced",
  "transfer",
  "stay",
  "provider-failure",
] as const;
export type BudgetState = (typeof budgetStates)[number];

export function budgetMediaFixture(
  state: BudgetState = "affordable",
  currency: CurrencyCode = "EUR",
  party: TravelerParty = { adults: 2, children: 0 },
) {
  const { base, request } = costTrip(currency);
  request.party = party;
  base.destination.name = { en: "Vienna", sq: "Vjena" };
  base.destination.country = { en: "Austria", sq: "Austri" };
  if (
    base.transport.mode !== "flight" ||
    base.transport.flightPricing.kind !== "priced"
  )
    throw Error("Invalid synthetic flight fixture");
  // With the synthetic EUR cost basket and two adults: 45200 spend + 4520 reserve.
  base.transport.flightPricing.quote.amount.cents = 5150;
  if (state === "reference") {
    const fare = structuredClone(base.transport.flightPricing.fare);
    fare.scope.dates = {
      startDate: "2026-11-12",
      endDate: "2026-11-14",
      flexibleDays: 0,
    };
    base.transport.flightPricing = { kind: "reference", referenceFare: fare };
  }
  if (state === "unpriced" || state === "provider-failure")
    base.transport.flightPricing = {
      kind: "unavailable",
      reason:
        state === "provider-failure"
          ? "provider-unavailable"
          : "no-matching-fare",
    };
  if (state === "transfer")
    base.transport.arrival = {
      destinationSubject: base.destination.id,
      providerCityCode: "VIE",
      flightDestinationCode: "VIE",
      airportCode: "VIE",
      label: {
        en: "Synthetic external gateway",
        sq: "Aeroport i jashtëm sintetik",
      },
      onwardTransfer: { status: "unpriced", required: true },
    };
  // Deliberately invalid stay duration: exercises the real fail-closed stay branch.
  if (state === "stay") request.nights = 0;
  const context = {
    today: "2026-10-08",
    profiles: [costProfile("city:VIE", currency)],
  };
  const first = pricePlan(base, request, "none", undefined, context);
  if (first.pricingCompleteness === "complete") {
    const needed = first.budget.budgetNeeded.cents;
    request.budget.cents =
      state === "exact"
        ? needed
        : state === "close"
          ? needed + 100
          : state === "reserve-over"
            ? 47000
            : state === "slightly-over"
              ? needed - 100
              : state === "unaffordable"
                ? 1000
                : needed + 50000;
  }
  return {
    base,
    request,
    plan: pricePlan(base, request, "none", undefined, context),
  };
}

/** FullTrip uses the normal engine context, so choose its test budget from that context. */
export function budgetMediaDetailFixture(
  state: BudgetState,
  currency: CurrencyCode = "EUR",
) {
  const { base, request } = budgetMediaFixture(state, currency);
  const initial = pricePlan(base, request);
  if (state === "reserve-over") {
    if (initial.pricingCompleteness !== "complete")
      throw Error("Synthetic detail fixture must have complete pricing");
    request.budget.cents =
      initial.budget.estimatedSpend.cents +
      Math.floor(initial.safetyBuffer.cents / 2);
  }
  return { base, request, plan: pricePlan(base, request) };
}
