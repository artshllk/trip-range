import type { MoneyDelta } from "./currency";
import type { FlightDiscoveryFare, PriceQuote, TripRequest } from "../types";

export const AVIASALES_DATA_PROVIDER = "travelpayouts-aviasales-data";

/**
 * Where a displayed amount came from. formatMoney accepts only Money, so an
 * amount without provenance cannot reach the page.
 */
export type MoneyProvenance =
  | {
      kind: "observed_fare";
      /** When we fetched it. Null only when the fetch time was not recorded. */
      fetchedAt: string | null;
      /** The provider's own observation time. Null: the provider did not say. */
      fareObservedAt: string | null;
      source: string;
    }
  | { kind: "planning_estimate" }
  | { kind: "user_input" }
  | {
      kind: "derived";
      /** Kinds of the amounts this figure was computed from. */
      inputs: readonly Exclude<MoneyProvenance["kind"], "derived">[];
    }
  | { kind: "demo_fixture" };

export type Money = MoneyDelta & { readonly provenance: MoneyProvenance };

const withProvenance = (
  amount: MoneyDelta,
  provenance: MoneyProvenance,
): Money => ({
  cents: amount.cents,
  currency: amount.currency,
  provenance,
});

/** A Trip Range planning figure: allowances, typical costs, transfer estimates. */
export const planningEstimate = (amount: MoneyDelta) =>
  withProvenance(amount, { kind: "planning_estimate" });

/** What the traveller typed (or a budget offered for them to pick). */
export const userInput = (amount: MoneyDelta) =>
  withProvenance(amount, { kind: "user_input" });

export const requestBudget = (request: Pick<TripRequest, "budget">) =>
  userInput(request.budget);

/** A quote's own provenance. Recent provider prices are observations; everything else is an estimate. */
export function quoteMoney(
  quote: Pick<
    PriceQuote,
    "amount" | "confidence" | "providerId" | "observedAt" | "demo" | "fetchedAt"
  >,
  amount: MoneyDelta = quote.amount,
): Money {
  if (quote.demo) return withProvenance(amount, { kind: "demo_fixture" });
  // Origin, not freshness: an Aviasales fare with no observation time is still an
  // observed provider fare (the adapter lowers its confidence), never our estimate.
  if (
    quote.providerId === AVIASALES_DATA_PROVIDER ||
    (quote.confidence === "recent" && !quote.providerId.startsWith("goeksplo-"))
  )
    return withProvenance(amount, {
      kind: "observed_fare",
      fetchedAt: quote.fetchedAt ?? null,
      fareObservedAt: quote.observedAt,
      source:
        quote.providerId === AVIASALES_DATA_PROVIDER
          ? "Aviasales"
          : quote.providerId,
    });
  return withProvenance(amount, { kind: "planning_estimate" });
}

/** A provider fare row (reference or matching). Its fetch time travels with it. */
export const fareMoney = (fare: FlightDiscoveryFare) =>
  quoteMoney({ ...fare.price, fetchedAt: fare.retrievedAt });

/** A figure computed from other amounts: totals, reserves, remainders, ceilings. */
export function derived(
  amount: MoneyDelta,
  inputs: readonly (Money | MoneyProvenance["kind"])[],
): Money {
  const kinds = new Set<Exclude<MoneyProvenance["kind"], "derived">>();
  for (const input of inputs) {
    const p =
      typeof input === "string"
        ? input === "derived"
          ? undefined
          : input
        : input.provenance.kind === "derived"
          ? undefined
          : input.provenance.kind;
    if (p) kinds.add(p);
    else if (typeof input !== "string" && input.provenance.kind === "derived")
      input.provenance.inputs.forEach((k) => kinds.add(k));
  }
  return withProvenance(amount, { kind: "derived", inputs: [...kinds] });
}

/** A plan-level sum. Its inputs are the plan's own cost lines. */
export const planDerived = (
  amount: MoneyDelta,
  plan: { costs: readonly PriceQuote[]; request: Pick<TripRequest, "budget"> },
  includeBudget = false,
) =>
  derived(amount, [
    ...plan.costs.map((c) => quoteMoney(c)),
    ...(includeBudget ? [requestBudget(plan.request)] : []),
  ]);

export function includesEstimate(money: Money): boolean {
  const p = money.provenance;
  return (
    p.kind === "planning_estimate" ||
    (p.kind === "derived" && p.inputs.includes("planning_estimate"))
  );
}
